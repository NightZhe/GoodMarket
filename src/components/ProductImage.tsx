interface Props {
  src: string;
  alt: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const emojiSize = { sm: 'text-2xl', md: 'text-6xl', lg: 'text-[9rem]' };

/** 支援一般圖片網址／data URL，以及示範資料用的 "art:emoji:from:to" 插圖 */
export default function ProductImage({ src, alt, className = '', size = 'md' }: Props) {
  if (src.startsWith('art:')) {
    const [, emoji, from, to] = src.split(':');
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex aspect-square items-center justify-center ${className}`}
        style={{ background: `radial-gradient(circle at 30% 25%, #ffffffcc, transparent 55%), linear-gradient(145deg, ${from}, ${to})` }}
      >
        <span className={`${emojiSize[size]} drop-shadow-[0_8px_12px_rgba(0,0,0,0.15)] select-none`}>{emoji}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={`aspect-square object-cover ${className}`} />;
}
