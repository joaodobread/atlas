/** Propriedades de estilo copiadas do CSS para o SVG exportado (o arquivo não leva a folha de estilos). */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'visibility',
  'display',
] as const;

const BACKGROUND = '#0b0e14';
const PADDING = 24;

export interface SvgSnapshot {
  markup: string;
  width: number;
  height: number;
}

/**
 * Copia o diagrama inteiro (não só a parte visível) para um SVG autossuficiente:
 * estilos computados viram atributos, animações e elementos marcados com data-export="skip" saem,
 * e o viewBox abraça o conteúdo.
 */
export function snapshotSvg(svg: SVGSVGElement): SvgSnapshot {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Mesma ordem de elementos no original e na cópia: dá para casar por índice e copiar os estilos computados.
  const originals = Array.from(svg.querySelectorAll<SVGElement>('*'));
  const copies = Array.from(clone.querySelectorAll<SVGElement>('*'));
  originals.forEach((el, i) => {
    const copy = copies[i]!;
    const cs = getComputedStyle(el);
    copy.setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    copy.removeAttribute('class');
  });
  // Fora: fundo da tela, partículas animadas (ficariam paradas na origem) e tooltips.
  for (const el of Array.from(clone.querySelectorAll('[data-export="skip"], animateMotion, animate, title'))) el.remove();

  // Área do conteúdo medida na própria cópia (já sem o que foi removido), fora da tela.
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  Object.assign(clone.style, { position: 'absolute', left: '-100000px', top: '0', width: '10px', height: '10px', visibility: 'hidden' });
  document.body.appendChild(clone);
  let box: DOMRect;
  try {
    box = clone.getBBox();
  } finally {
    clone.remove();
  }
  if (!box.width || !box.height) throw new Error('Nada para exportar');
  const x = Math.floor(box.x - PADDING);
  const y = Math.floor(box.y - PADDING);
  const width = Math.ceil(box.width + PADDING * 2);
  const height = Math.ceil(box.height + PADDING * 2);

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('style', `background:${BACKGROUND}`);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of Object.entries({ x, y, width, height, fill: BACKGROUND })) bg.setAttribute(k, String(v));
  clone.insertBefore(bg, clone.firstChild);

  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasteriza o SVG em PNG (2x, para ficar nítido em telas retina), dentro do tamanho máximo de canvas dos navegadores. */
export async function svgToPng(snapshot: SvgSnapshot, scale = 2): Promise<Blob> {
  const MAX_SIDE = 16_000;
  const s = Math.min(scale, MAX_SIDE / snapshot.width, MAX_SIDE / snapshot.height);
  const img = new Image();
  img.decoding = 'async';
  const url = URL.createObjectURL(new Blob([snapshot.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(snapshot.width * s);
    canvas.height = Math.round(snapshot.height * s);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível');
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar o PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
