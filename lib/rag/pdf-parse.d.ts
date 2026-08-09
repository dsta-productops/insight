// @types/pdf-parse only declares the package root, not the internal lib entry
// we import to sidestep pdf-parse's index.js debug block.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdf from "pdf-parse";
  export default pdf;
}
