"use client";
import { ImagePlus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ACCEPTED_IMAGE_TYPES,
  fileToMessageImage,
  isAcceptedImageType,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type MessageImage,
  messageImageToDataUrl,
} from "@/lib/chat-images";

export function useChatImages() {
  const [images, setImages] = useState<MessageImage[]>([]);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const pending = useRef(false);
  const add = async (files: File[]) => {
    if (pending.current || !files.length) return;
    pending.current = true;
    setReading(true);
    setError("");
    try {
      if (images.length + files.length > MAX_IMAGES_PER_MESSAGE)
        throw new Error("한 번에 이미지를 최대 5장까지 첨부할 수 있습니다.");
      if (files.some((file) => !isAcceptedImageType(file.type)))
        throw new Error("PNG·JPEG·WebP·GIF 이미지를 선택하세요.");
      if (files.some((file) => !file.size || file.size > MAX_IMAGE_BYTES))
        throw new Error("이미지는 한 장에 최대 5MB까지 첨부할 수 있습니다.");
      const added = await Promise.all(files.map(fileToMessageImage));
      setImages((current) =>
        [...current, ...added].slice(0, MAX_IMAGES_PER_MESSAGE),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "이미지를 읽지 못했습니다.",
      );
    } finally {
      pending.current = false;
      setReading(false);
    }
  };
  return {
    images,
    error,
    reading,
    add,
    remove: (index: number) => {
      setImages((current) => current.filter((_, i) => i !== index));
      setError("");
    },
    clear: () => {
      setImages([]);
      setError("");
    },
  };
}

export function ChatImages({
  images,
  onRemove,
  disabled,
}: {
  images: { name: string; href: string }[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}) {
  if (!images.length) return null;
  return (
    <section className="chat-images" aria-label="첨부 이미지">
      {images.map((image, index) => (
        <div className="chat-image" key={`${image.name}-${index}`}>
          <Dialog>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="chat-image-open"
                aria-label={`${image.name} 확대`}
              >
                {/* Authenticated chat files must be fetched by the user's browser. */}
                {/* biome-ignore lint/performance/noImgElement: private authenticated image or local attachment preview */}
                <img src={image.href} alt={image.name} width={96} height={72} />
              </Button>
            </DialogTrigger>
            <DialogContent className="chat-image-dialog">
              <DialogHeader>
                <DialogTitle>{image.name}</DialogTitle>
                <DialogDescription>
                  대화에 첨부한 이미지입니다.
                </DialogDescription>
              </DialogHeader>
              {/* biome-ignore lint/performance/noImgElement: private authenticated image */}
              <img src={image.href} alt={image.name} />
            </DialogContent>
          </Dialog>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="chat-image-remove"
              disabled={disabled}
              onClick={() => onRemove(index)}
              aria-label={`${image.name} 첨부 삭제`}
            >
              <X size={15} />
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

export function ChatImagePicker({
  input,
  disabled,
}: {
  input: ReturnType<typeof useChatImages>;
  disabled: boolean;
}) {
  const id = useId();
  const picker = useRef<HTMLInputElement | null>(null);
  return (
    <div className="chat-image-picker">
      <Input
        ref={picker}
        id={id}
        className="chat-image-file-input"
        hidden
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        aria-label="채팅 이미지 파일"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void input.add(files);
        }}
      />
      <div className="chat-image-picker-heading">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || input.images.length >= MAX_IMAGES_PER_MESSAGE}
          onClick={() => picker.current?.click()}
        >
          <ImagePlus size={17} />
          {input.reading ? "이미지 읽는 중…" : "이미지 첨부"}
        </Button>
        <span className="field-help">최대 5장 · 장당 5MB</span>
      </div>
      <ChatImages
        images={input.images.map((image) => ({
          name: image.name,
          href: messageImageToDataUrl(image),
        }))}
        onRemove={input.remove}
        disabled={disabled}
      />
      {input.error && (
        <p role="alert" className="form-error">
          {input.error}
        </p>
      )}
    </div>
  );
}
