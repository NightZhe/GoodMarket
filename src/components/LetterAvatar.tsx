interface Props {
  name: string;
  /** 直徑 px，預設 48 */
  size?: number;
}

/** 店名首字的圓形頭像。店名請另外以文字呈現，所以這裡 aria-hidden */
export default function LetterAvatar({ name, size = 48 }: Props) {
  const initial = [...name.trim()][0] ?? '店';
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 select-none place-items-center rounded-full bg-linear-to-b from-muted/85 to-muted font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {initial}
    </span>
  );
}
