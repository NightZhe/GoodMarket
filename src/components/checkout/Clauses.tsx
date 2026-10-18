/**
 * 中文句子依標點切成片段，每段一個 inline-block：窄欄只在標點後換行，不會把「原本 $500」「變動」拆成兩行
 * （design.md 第 2 節第 7 點、5.2）
 */
export default function Clauses({ text }: { text: string }) {
  return <>{text.split(/(?<=[：，、])/).map((part, i) => <span key={i} className="inline-block">{part}</span>)}</>;
}
