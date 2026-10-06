/** "5511987654321" → "+55 11 98765-4321"; anything that isn't a Brazilian number is shown as "+<digits>". */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
}
