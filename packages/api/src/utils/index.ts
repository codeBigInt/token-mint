import { Logger } from "pino";

export const randomNonceBytes = (length: number, logger?: Logger): Uint8Array => {
    const newBytes = new Uint8Array(length);
    crypto.getRandomValues(newBytes);
    logger?.info("Random nonce bytes", newBytes)
    return newBytes;
}

export function uint8arraytostring<T extends Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray>(array: T) {
    const deocodedText = new TextDecoder().decode(array);
    return deocodedText.toString()
}