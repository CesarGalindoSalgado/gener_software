// html2pdf.js no incluye tipos; declaración mínima para lo que usamos.
declare module 'html2pdf.js' {
  interface Html2Pdf {
    set(opt: Record<string, unknown>): Html2Pdf;
    from(element: HTMLElement): Html2Pdf;
    save(): Promise<void>;
  }
  export default function html2pdf(): Html2Pdf;
}
