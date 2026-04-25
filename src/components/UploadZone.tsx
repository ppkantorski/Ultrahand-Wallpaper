import { useCallback, useRef, useState } from "react";
import { Upload, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onFile: (file: File) => void;
};

export function UploadZone({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0]!;
      // Accept anything with an image/ MIME type, plus raw .rgba dumps.
      // .rgba files typically have no MIME (or "application/octet-stream"),
      // so we fall back to extension matching.
      const isImage = file.type.startsWith("image/");
      const isRgba = /\.rgba$/i.test(file.name);
      if (!isImage && !isRgba) return;
      onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center w-full h-full rounded-2xl border-2 border-dashed cursor-pointer transition-colors",
        "bg-card text-card-foreground",
        dragging
          ? "border-[#22ff66] bg-[#22ff66]/5"
          : "border-border hover:border-[#22ff66]/60",
      )}
      data-testid="upload-zone"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.rgba"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid="upload-input"
      />
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22ff66]/10 text-[#22ff66]">
          {dragging ? (
            <Upload className="h-6 w-6" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
        </div>
        <div>
          <p className="text-base font-medium">Drop an image to begin</p>
          <p className="mt-1 text-sm text-muted-foreground">
            or click to browse — PNG, JPG, GIF, WEBP, RGBA
          </p>
        </div>
      </div>
    </div>
  );
}
