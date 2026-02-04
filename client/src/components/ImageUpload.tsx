import { useState, useRef } from 'react';

interface ImageUploadProps {
  onUploadComplete: (imageUrl: string) => void;
  currentUrl?: string;
}

export function ImageUpload({ onUploadComplete, currentUrl }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const response = await fetch('/api/uploads/request-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { uploadURL, objectPath } = await response.json();

      await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      const publicUrl = `${window.location.origin}${objectPath}`;
      setPreviewUrl(URL.createObjectURL(file));
      onUploadComplete(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setPreviewUrl(null);
    onUploadComplete('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          disabled={uploading}
          style={{ flex: 1 }}
        />
        {previewUrl && (
          <button
            type="button"
            onClick={handleClear}
            style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>
      {uploading && <p style={{ fontSize: '12px', color: '#3182ce', marginTop: '4px' }}>Uploading...</p>}
      {error && <p style={{ fontSize: '12px', color: '#e53e3e', marginTop: '4px' }}>{error}</p>}
      {previewUrl && (
        <div style={{ marginTop: '8px' }}>
          <img
            src={previewUrl}
            alt="Preview"
            style={{ maxWidth: '200px', maxHeight: '150px', borderRadius: '4px', border: '1px solid #e2e8f0' }}
          />
        </div>
      )}
    </div>
  );
}
