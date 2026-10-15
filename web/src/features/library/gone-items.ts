/**
 * 本会话里「服务端说已不存在」的条目 id(播放器取详情得到 404 Not Found 时登记)。
 * 列表与精选目录据此立刻丢掉它(或把精选卡的 `addedItemId` 清掉),不用等下一次重取;条目 id 是 uuid,不会复用。
 */
const gone = new Set<string>();

export const markItemGone = (id: string): void => { gone.add(id); };
export const isItemGone = (id: string): boolean => gone.has(id);
/** 测试用。 */
export const resetGoneItems = (): void => { gone.clear(); };
