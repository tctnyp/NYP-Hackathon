import { ChangeEvent, useState } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { BackgroundPreference, useTheme } from '../contexts/ThemeContext';
import { deleteBackground, uploadBackground } from '../services/media';
import { resizeBackgroundImage } from '../utils/imageResize';

const presets: Array<BackgroundPreference & { name: string }> = [
  { name: 'Default', kind: 'default', value: '' },
  { name: 'Cloud', kind: 'solid', value: '#e0f2fe' },
  { name: 'Mint', kind: 'solid', value: '#dcfce7' },
  { name: 'Lavender', kind: 'solid', value: '#ede9fe' },
  { name: 'Sunrise', kind: 'gradient', value: 'linear-gradient(135deg, #fef3c7, #fecdd3)' },
  { name: 'Ocean', kind: 'gradient', value: 'linear-gradient(135deg, #dbeafe, #cffafe)' },
  { name: 'Aurora', kind: 'gradient', value: 'linear-gradient(135deg, #dcfce7, #e9d5ff)' },
  { name: 'Dusk', kind: 'gradient', value: 'linear-gradient(135deg, #312e81, #831843)' },
];

function BackgroundPicker() {
  const { background, setBackground } = useTheme();
  const [solidColor, setSolidColor] = useState('#dbeafe');
  const [gradientStart, setGradientStart] = useState('#dbeafe');
  const [gradientEnd, setGradientEnd] = useState('#e9d5ff');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  const isActive = (preset: BackgroundPreference) => (
    preset.kind === background.kind && preset.value === background.value
  );

  const setNonImageBackground = (next: BackgroundPreference) => {
    if (background.kind === 'image' && background.media_key) {
      void deleteBackground(background.media_key).catch(() => {});
    }
    setBackground(next);
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setUploadError('');
    if (!file) return;

    setUploading(true);
    try {
      const resized = await resizeBackgroundImage(file);
      const stored = await uploadBackground(resized);
      if (background.kind === 'image' && background.media_key) {
        void deleteBackground(background.media_key).catch(() => {});
      }
      setBackground({ kind: 'image', value: stored.access_url, media_key: stored.object_key });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unable to upload that background image.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Background</p>
        <div className="background-grid">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className={isActive(preset) ? 'background-swatch background-swatch-active' : 'background-swatch'}
              style={{ background: preset.kind === 'default' ? 'var(--app-bg)' : preset.value }}
              onClick={() => setNonImageBackground({ kind: preset.kind, value: preset.value })}
              title={preset.name}
              aria-label={`${preset.name} background`}
              aria-pressed={isActive(preset)}
            >
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="appearance-row">
        <label className="appearance-color">
          <span>Solid</span>
          <input
            type="color"
            value={solidColor}
            onChange={(event) => {
              setSolidColor(event.target.value);
              setNonImageBackground({ kind: 'solid', value: event.target.value });
            }}
            aria-label="Custom solid background color"
          />
        </label>
        <label className="appearance-color">
          <span>Gradient</span>
          <span className="flex gap-1">
            <input type="color" value={gradientStart} onChange={(event) => setGradientStart(event.target.value)} aria-label="Gradient start color" />
            <input type="color" value={gradientEnd} onChange={(event) => setGradientEnd(event.target.value)} aria-label="Gradient end color" />
          </span>
        </label>
        <button
          type="button"
          className="appearance-apply"
          onClick={() => setBackground({ kind: 'gradient', value: `linear-gradient(135deg, ${gradientStart}, ${gradientEnd})` })}
        >
          Apply
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="appearance-upload">
          {uploading ? <ImagePlus className="animate-pulse" size={17} /> : <ImagePlus size={17} />} {uploading ? 'Resizing and uploading…' : 'Custom image'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(event) => void uploadImage(event)} />
        </label>
        <button type="button" className="appearance-upload" onClick={() => setNonImageBackground({ kind: 'default', value: '' })}>
          <RotateCcw size={16} /> Reset
        </button>
      </div>
      <p className="text-xs text-gray-500">Images under 100 MiB are resized to fit 2560×1440 and stored privately in Amazon S3.</p>
      {uploadError && <p className="text-xs font-medium text-red-600" role="alert">{uploadError}</p>}
    </div>
  );
}

export default BackgroundPicker;
