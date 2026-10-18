import Image from "next/image";

export default function AvatarImage({
  src,
  alt,
  size,
  className = "",
}: {
  src: string;
  alt: string;
  size: number;
  className?: string;
}) {
  return (
    <Image
      className={`avatar-image ${className}`.trim()}
      src={src}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      style={{ width: size, height: size }}
    />
  );
}
