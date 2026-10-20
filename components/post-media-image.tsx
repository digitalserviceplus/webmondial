export default function PostMediaImage({ src }: { src: string }) {
  return (
    // The source dimensions vary; use the browser's intrinsic ratio without fixed Next Image dimensions.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="post-media post-media-image" src={src} alt="" decoding="async" />
  );
}
