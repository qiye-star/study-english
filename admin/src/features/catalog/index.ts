/** features/catalog 的公开出口(app.tsx 只从这里导入;layout 只导入 strings / catalog-icon,避免循环)。 */
export * from "./api";
export { CatalogPage } from "./catalog-page";
