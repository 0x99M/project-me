/** 1 -> "0x01": product numbers written the way the 0x99M name is. */
export function hex(n: number) {
  return "0x" + n.toString(16).toUpperCase().padStart(2, "0");
}
