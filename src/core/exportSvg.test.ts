import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, snapshotSvg, svgToPng, type SvgSnapshot } from './exportSvg.ts';

const NS = 'http://www.w3.org/2000/svg';

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  svg.innerHTML = `
    <rect class="bg" data-export="skip" width="800" height="600"></rect>
    <g class="node"><circle class="dot" cx="10" cy="10" r="5"><title>tooltip</title></circle><text class="label">API</text></g>
    <circle r="1"><animateMotion dur="1s"></animateMotion></circle>
    <animate attributeName="opacity"></animate>`;
  document.body.appendChild(svg);
  return svg;
}

function stubBBox(box: { x: number; y: number; width: number; height: number }) {
  const proto = SVGSVGElement.prototype as unknown as { getBBox?: () => DOMRect };
  const original = Object.getOwnPropertyDescriptor(proto, 'getBBox');
  Object.defineProperty(proto, 'getBBox', { configurable: true, value: () => box });
  return () => {
    if (original) Object.defineProperty(proto, 'getBBox', original);
    else delete proto.getBBox;
  };
}

describe('snapshotSvg', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    document.body.innerHTML = '';
  });

  it('gera um SVG autossuficiente com viewBox, fundo e estilos inline', () => {
    restore = stubBBox({ x: 10.5, y: -5.2, width: 100.2, height: 50 });
    const svg = makeSvg();
    const snap = snapshotSvg(svg);
    expect(snap.width).toBe(Math.ceil(100.2 + 48));
    expect(snap.height).toBe(98);

    const doc = new DOMParser().parseFromString(snap.markup, 'image/svg+xml');
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).toBe(`-14 -30 ${snap.width} 98`);
    expect(root.getAttribute('width')).toBe(String(snap.width));
    expect(root.getAttribute('style')).toBe('background:#0b0e14');
    // Primeiro filho é o retângulo de fundo.
    const bg = root.firstElementChild!;
    expect(bg.tagName.toLowerCase()).toBe('rect');
    expect(bg.getAttribute('fill')).toBe('#0b0e14');
    expect(bg.getAttribute('x')).toBe('-14');
    // Removidos: skip, title, animateMotion e animate.
    expect(snap.markup).not.toContain('data-export');
    expect(snap.markup).not.toContain('tooltip');
    expect(snap.markup).not.toContain('animateMotion');
    expect(snap.markup).not.toContain('<animate');
    // Classes viram estilos inline.
    expect(snap.markup).not.toContain('class=');
    expect(root.querySelector('text')!.getAttribute('style')).toContain('fill:');
    // O original não é alterado e a cópia de medição foi removida do documento.
    expect(svg.getAttribute('width')).toBe('800');
    expect(svg.querySelector('title')).not.toBeNull();
    expect(document.body.querySelectorAll('svg')).toHaveLength(1);
  });

  it('falha quando não há nada para exportar', () => {
    restore = stubBBox({ x: 0, y: 0, width: 0, height: 0 });
    expect(() => snapshotSvg(makeSvg())).toThrow('Nada para exportar');
    expect(document.body.querySelectorAll('svg')).toHaveLength(1);
  });

  it('remove a cópia mesmo se getBBox lançar', () => {
    const proto = SVGSVGElement.prototype as unknown as { getBBox?: () => DOMRect };
    const original = Object.getOwnPropertyDescriptor(proto, 'getBBox');
    Object.defineProperty(proto, 'getBBox', {
      configurable: true,
      value: () => {
        throw new Error('sem layout');
      },
    });
    restore = () => {
      if (original) Object.defineProperty(proto, 'getBBox', original);
      else delete proto.getBBox;
    };
    expect(() => snapshotSvg(makeSvg())).toThrow('sem layout');
    expect(document.body.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cria um link, clica e revoga a URL depois', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:abc');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:abc');
      expect(this.download).toBe('grafo.svg');
    });
    const blob = new Blob(['x']);
    downloadBlob(blob, 'grafo.svg');
    expect(create).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:abc');
  });
});

describe('svgToPng', () => {
  const snapshot: SvgSnapshot = { markup: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 100, height: 50 };
  type Ctx = {
    fillStyle: string;
    fillRect: ReturnType<typeof vi.fn<(...args: number[]) => void>>;
    drawImage: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  };
  let ctx: Ctx;
  let toBlobResult: Blob | null;
  let canvas: { width: number; height: number; getContext: () => Ctx | null; toBlob: (cb: (b: Blob | null) => void, type: string) => void };
  let revoke: ReturnType<typeof vi.spyOn>;
  let decode: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    ctx = { fillStyle: '', fillRect: vi.fn<(...args: number[]) => void>(), drawImage: vi.fn<(...args: unknown[]) => void>() };
    toBlobResult = new Blob(['png'], { type: 'image/png' });
    canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb) => cb(toBlobResult) };
    decode = vi.fn<() => Promise<void>>(() => Promise.resolve());
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(decode);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : realCreate(tag))) as typeof document.createElement);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('desenha o SVG num canvas 2x com fundo e devolve o PNG', async () => {
    const blob = await svgToPng(snapshot);
    expect(blob).toBe(toBlobResult);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(ctx.fillStyle).toBe('#0b0e14');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 200, 100);
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });

  it('limita a escala ao tamanho máximo do canvas', async () => {
    await svgToPng({ ...snapshot, width: 32_000, height: 100 });
    expect(canvas.width).toBe(16_000);
    expect(canvas.height).toBe(50);
  });

  it('falha sem contexto 2D (e ainda revoga a URL)', async () => {
    canvas.getContext = () => null;
    await expect(svgToPng(snapshot)).rejects.toThrow('Canvas indisponível');
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });

  it('falha quando o canvas não gera o blob', async () => {
    toBlobResult = null;
    await expect(svgToPng(snapshot)).rejects.toThrow('Falha ao gerar o PNG');
  });

  it('propaga erro de decodificação da imagem', async () => {
    decode.mockImplementation(() => Promise.reject(new Error('decode')));
    await expect(svgToPng(snapshot)).rejects.toThrow('decode');
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });
});
