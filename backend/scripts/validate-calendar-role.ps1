param(
  [Parameter(Mandatory = $true)][string]$RoleArn,
  [Parameter(Mandatory = $true)][string]$AccountId,
  [string]$Region = 'us-east-1',
  [ValidateSet('dev', 'staging', 'prod')][string]$Environment = 'prod'
)

$ErrorActionPreference = 'Stop'
$tablePrefix = "arn:aws:dynamodb:${Region}:${AccountId}:table/"
$userPool = "arn:aws:cognito-idp:${Region}:${AccountId}:userpool/*"
$queue = "arn:aws:sqs:${Region}:${AccountId}:academic-google-calendar-sync-failures-${Environment}"
$logGroups = "arn:aws:logs:${Region}:${AccountId}:log-group:/aws/lambda/*"

$checks = @(
  @{ Resource = "${tablePrefix}academic-task-users-${Environment}"; Actions = @('dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:TransactWriteItems') },
  @{ Resource = "${tablePrefix}academic-google-calendar-${Environment}"; Actions = @('dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Scan', 'dynamodb:TransactWriteItems') },
  @{ Resource = "${tablePrefix}academic-tasks-${Environment}"; Actions = @('dynamodb:GetItem', 'dynamodb:Query') },
  @{ Resource = "${tablePrefix}academic-tasks-${Environment}/stream/*"; Actions = @('dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator') },
  @{ Resource = $queue; Actions = @('sqs:SendMessage') },
  @{ Resource = $userPool; Actions = @('cognito-idp:AdminLinkProviderForUser', 'cognito-idp:AdminDisableProviderForUser') },
  @{ Resource = $logGroups; Actions = @('logs:CreateLogStream', 'logs:PutLogEvents') },
  @{ Resource = '*'; Actions = @('dynamodb:ListStreams', 'logs:CreateLogGroup') }
)

$denied = @()
foreach ($check in $checks) {
  $result = aws iam simulate-principal-policy `
    --policy-source-arn $RoleArn `
    --action-names $check.Actions `
    --resource-arns $check.Resource `
    --output json | ConvertFrom-Json
  foreach ($evaluation in $result.EvaluationResults) {
    if ($evaluation.EvalDecision -ne 'allowed') {
      $denied += "$($evaluation.EvalActionName) on $($check.Resource): $($evaluation.EvalDecision)"
    }
  }
}

if ($denied.Count -gt 0) {
  Write-Error ("Calendar execution-role contract failed:`n - " + ($denied -join "`n - "))
}

Write-Output "Calendar execution-role contract validated for $RoleArn ($Environment/$Region)."
