/** "5511987654321" → "+55 11 98765-4321". Anything that isn't a Brazilian number with country code is shown as stored. */
export function formatPhone(phone: string): string {
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone.replace(/\D/g, ""));
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : phone;
}
