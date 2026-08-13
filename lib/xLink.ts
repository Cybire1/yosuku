export function xLinkMessage(authorId: string, wallet: string): Uint8Array {
  return new TextEncoder().encode([
    'Yosuku X account link',
    `X user: ${authorId}`,
    `Wallet: ${wallet.toLowerCase()}`,
  ].join('\n'));
}

export function xUnlinkMessage(authorId: string, wallet: string): Uint8Array {
  return new TextEncoder().encode([
    'Yosuku X account disconnect',
    `X user: ${authorId}`,
    `Wallet: ${wallet.toLowerCase()}`,
    'This removes the X route only. Funds remain in the wallet-owned betting balance.',
  ].join('\n'));
}
