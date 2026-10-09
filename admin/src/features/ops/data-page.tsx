import { Page } from "../../components/layout";
import { BackupsTable } from "./backups-table";
import { AuditPurgeCard, OrphanRecordingsCard } from "./housekeeping-card";
import { S } from "./strings";

/** 数据与备份(superadmin):备份表、孤儿录音、审计清理;删除/下载/清理都要二次验证(客户端自动弹框重放)。 */
export function DataPage() {
  return (
    <Page title={S.dataPage}>
      <BackupsTable />
      <div className="grid grid-cols-2 gap-3">
        <OrphanRecordingsCard />
        <AuditPurgeCard />
      </div>
    </Page>
  );
}
