import LeaveDialog from '../import/LeaveDialog';

interface Props {
  shopName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** S-K9 封鎖確認。初始焦點與 Esc 都是「取消」（LeaveDialog 的安全選項）；「封鎖」是紅字次要鈕，不做實心紅 */
export default function BlockConfirm({ shopName, onConfirm, onCancel }: Props) {
  return (
    <LeaveDialog
      title={`封鎖『${shopName}』？`}
      description="封鎖後，這台裝置上不會再看到這家店的商品。可以隨時在店家頁或『我的 › 已封鎖的店家』取消。"
      stayLabel="取消" leaveLabel="封鎖"
      onStay={onCancel} onLeave={onConfirm}
    />
  );
}
