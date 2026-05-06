/**
 * Helpers para gerar números aleatórios via Web Crypto API.
 *
 * Use em qualquer lugar onde Math.random é tentador — mesmo em casos
 * não-criptográficos (jitter de backoff, placeholder visual, etc.). Custo
 * é desprezível e elimina falso-positivo de SAST tools que alertam sobre
 * cryptographically weak random.
 */

/**
 * Retorna um float em [0, 1) usando getRandomValues. Substituto direto
 * para Math.random() — mesma assinatura, mesma semântica.
 */
export function secureRandomFraction(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}

/**
 * Retorna um inteiro em [0, max). Substituto para Math.floor(Math.random() * max).
 */
export function secureRandomInt(max: number): number {
  return Math.floor(secureRandomFraction() * max);
}
