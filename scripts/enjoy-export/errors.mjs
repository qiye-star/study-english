// Error with a stable reason code (plan R-E5 / R-E9 codes plus internal ones).
// The CLI prints the message; it never prints a record's title, file name or md5.
export class ExportError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'ExportError';
    this.code = code;
  }
}
