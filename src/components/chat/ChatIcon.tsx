interface Props {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * 聊聊圖示（設計稿 §11、.work/chat/chat-icon.svg）：圓角對話框＋兩行字，單色線條，跟著文字色。
 * 結構與 data/categoryIcons.tsx 的 glyph() 相同；路徑逐字取自設計稿。圖示只是裝飾，名稱由旁邊的文字提供，所以 aria-hidden
 */
export default function ChatIcon({ size = 24, className, strokeWidth = 1.7 }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 4h8a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5h-4.5L8 20.5V17a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z" />
      <path d="M8.5 9h7M8.5 12.5h4" />
    </svg>
  );
}
