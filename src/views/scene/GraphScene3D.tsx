import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { NodeKind } from '../../../shared/constants.ts';
import type { ForceLayout, LayoutNode } from '../../domain/ForceLayout.ts';
import type { VisibleEdge } from '../../domain/GraphIndex.ts';
import { useGraphSceneViewModel, type SceneNode } from '../../viewmodels/useGraphSceneViewModel.ts';
import { NodeIcon } from '../icons/NodeIcon.tsx';

const noRaycast = () => null;
const UP = new THREE.Vector3(0, 1, 0);

export function GraphScene3D() {
  const vm = useGraphSceneViewModel(3);
  const layout = vm.layout;

  return (
    <Canvas
      camera={{ position: [0, 12, 42], fov: 55 }}
      raycaster={{ params: { Line: { threshold: 0.3 } } } as Partial<THREE.Raycaster>}
      onPointerMissed={vm.clearSelection}
    >
      <color attach="background" args={['#0b0e14']} />
      <ambientLight intensity={0.7} />
      <pointLight position={[40, 50, 40]} intensity={1.4} decay={0} />
      <pointLight position={[-40, -30, -20]} intensity={0.5} decay={0} />
      <Stars radius={220} depth={60} count={2500} factor={4} fade />

      <LayoutTicker layout={layout} />
      <CameraFitter layout={layout} request={vm.fitRequest} />
      <TreeLinks nodes={vm.nodes} layout={layout} />
      {vm.edges.map((e) => (
        <EdgeView
          key={e.key}
          edge={e}
          layout={layout}
          highlighted={vm.isEdgeHighlighted(e)}
          showLabel={vm.highlight != null && vm.isEdgeHighlighted(e)}
          label={vm.edgeLabel(e)}
          onSelect={() => vm.selectEdge(e)}
        />
      ))}
      {vm.nodes.map((n) => (
        <NodeView
          key={n.id}
          node={n}
          layout={layout}
          selected={vm.selectedNodeId === n.id}
          dimmed={!vm.isNodeHighlighted(n.id)}
          onSelect={vm.activateNode}
          onToggle={vm.toggleExpanded}
        />
      ))}
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}

function LayoutTicker({ layout }: { layout: ForceLayout }) {
  useFrame(() => {
    layout.tick();
  });
  return null;
}

interface OrbitLike {
  target: THREE.Vector3;
  update(): void;
}

/**
 * Enquadra a câmera no grafo: automaticamente quando o layout assenta após o carregamento
 * e sempre que `request` muda (botão "Enquadrar").
 */
function CameraFitter({ layout, request }: { layout: ForceLayout; request: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const pending = useRef<'auto' | 'now' | null>('auto');
  const waited = useRef(0);
  const anim = useRef<{ fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null>(null);

  useEffect(() => {
    if (request > 0) pending.current = 'now';
  }, [request]);

  useFrame((_, delta) => {
    if (!controls) return;
    const nodes = layout.all();
    if (pending.current && nodes.length) {
      waited.current++;
      // 'now' enquadra já (e de novo quando o layout assentar); 'auto' espera assentar (máx. ~3s).
      if (pending.current === 'now' || !layout.isSettling() || waited.current > 180) {
        const fit = fitView(nodes, camera, controls.target);
        anim.current = { fromPos: camera.position.clone(), toPos: fit.position, fromTarget: controls.target.clone(), toTarget: fit.target, t: 0 };
        // Se ainda está se acomodando, enquadra de novo depois.
        pending.current = layout.isSettling() ? 'auto' : null;
        waited.current = 0;
      }
    }
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + delta * 2.2);
      const k = 1 - Math.pow(1 - a.t, 3);
      camera.position.lerpVectors(a.fromPos, a.toPos, k);
      controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      controls.update();
      if (a.t >= 1) anim.current = null;
    }
  });
  return null;
}

/**
 * Calcula posição da câmera (mantendo a direção atual) para que todos os nós caibam na tela,
 * projetando-os nos eixos da câmera em vez de usar uma esfera envolvente.
 */
function fitView(nodes: readonly LayoutNode[], camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  const box = new THREE.Box3();
  for (const n of nodes) box.expandByPoint(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0));
  const center = box.getCenter(new THREE.Vector3());

  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const back = camera.position.clone().sub(target).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;

  const rel = new THREE.Vector3();
  let dist = 6;
  for (const n of nodes) {
    rel.set((n.x ?? 0) - center.x, (n.y ?? 0) - center.y, (n.z ?? 0) - center.z);
    const pad = n.r + 1.2; // espaço para o rótulo
    const need = Math.max((Math.abs(rel.dot(right)) + pad) / tanH, (Math.abs(rel.dot(up)) + pad) / tanV);
    dist = Math.max(dist, need + rel.dot(back));
  }
  return { target: center, position: center.clone().addScaledVector(back, dist * 1.18) };
}

function KindGeometry({ kind, r }: { kind: NodeKind; r: number }) {
  switch (kind) {
    case 'database':
      return <cylinderGeometry args={[r * 0.8, r * 0.8, r * 1.5, 32]} />;
    case 'infra':
      return <boxGeometry args={[r * 1.5, r * 1.5, r * 1.5]} />;
    case 'queue':
      return <torusGeometry args={[r * 0.7, r * 0.3, 16, 40]} />;
    case 'external':
      return <octahedronGeometry args={[r * 1.1]} />;
    case 'service':
      return <dodecahedronGeometry args={[r]} />;
    case 'module':
      return <icosahedronGeometry args={[r, 1]} />;
    default:
      return <sphereGeometry args={[r, 32, 24]} />;
  }
}

interface NodeViewProps {
  node: SceneNode;
  layout: ForceLayout;
  selected: boolean;
  dimmed: boolean;
  onSelect(id: number): void;
  onToggle(id: number): void;
}

function NodeView({ node, layout, selected, dimmed, onSelect, onToggle }: NodeViewProps) {
  const ref = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);

  useFrame(() => {
    const p = layout.position(node.id);
    if (p && ref.current) ref.current.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  });

  useEffect(() => () => void (document.body.style.cursor = ''), []);

  const stop = (fn: () => void) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    fn();
  };

  return (
    <group ref={ref}>
      <mesh
        onClick={stop(() => onSelect(node.id))}
        onDoubleClick={stop(() => onToggle(node.id))}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <KindGeometry kind={node.kind} r={node.r} />
        <meshStandardMaterial
          color={node.color}
          emissive={node.color}
          emissiveIntensity={selected ? 0.65 : hover ? 0.4 : 0.15}
          roughness={0.45}
          metalness={0.1}
          transparent
          opacity={dimmed ? 0.22 : node.isContext ? 0.55 : 1}
        />
      </mesh>
      {node.hiddenCount > 0 && (
        <mesh raycast={noRaycast}>
          <sphereGeometry args={[node.r * 1.5, 16, 12]} />
          <meshBasicMaterial color={node.color} wireframe transparent opacity={dimmed ? 0.05 : 0.18} />
        </mesh>
      )}
      {selected && (
        <mesh raycast={noRaycast} rotation-x={Math.PI / 2}>
          <torusGeometry args={[node.r * 1.75, 0.05, 8, 64]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      <Html position={[0, node.r + 0.55, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`node-label${dimmed ? ' dim' : ''}${selected ? ' selected' : ''}${node.isContext ? ' context' : ''}`}>
          <span className="node-label-title">
            <span className="node-label-icon" style={{ borderColor: node.color }}>
              <NodeIcon id={node.icon} size={14} color={node.color} />
            </span>
            {node.isContext ? node.path : node.name}
            {node.hiddenCount > 0 && <span className="badge">+{node.hiddenCount}</span>}
          </span>
          <small>{node.tech ? `${node.kindLabel} · ${node.tech}` : node.kindLabel}</small>
        </div>
      </Html>
    </group>
  );
}

/** Linhas pai → filho (hierarquia), num único buffer. */
function TreeLinks({ nodes, layout }: { nodes: SceneNode[]; layout: ForceLayout }) {
  const pairs = useMemo(() => nodes.filter((n) => n.parentId != null).map((n) => [n.id, n.parentId!] as const), [nodes]);
  const object = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, pairs.length) * 6), 3));
    geometry.setDrawRange(0, pairs.length * 2);
    const material = new THREE.LineBasicMaterial({ color: '#3b4660', transparent: true, opacity: 0.7 });
    const lines = new THREE.LineSegments(geometry, material);
    lines.raycast = noRaycast;
    return lines;
  }, [pairs]);

  useEffect(
    () => () => {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    },
    [object],
  );

  useFrame(() => {
    const attr = object.geometry.getAttribute('position') as THREE.BufferAttribute;
    pairs.forEach(([a, b], i) => {
      const pa = layout.position(a);
      const pb = layout.position(b);
      if (!pa || !pb) return;
      attr.setXYZ(i * 2, pa.x ?? 0, pa.y ?? 0, pa.z ?? 0);
      attr.setXYZ(i * 2 + 1, pb.x ?? 0, pb.y ?? 0, pb.z ?? 0);
    });
    attr.needsUpdate = true;
    object.geometry.computeBoundingSphere();
  });

  return <primitive object={object} />;
}

interface EdgeViewProps {
  edge: VisibleEdge;
  layout: ForceLayout;
  highlighted: boolean;
  showLabel: boolean;
  label: string;
  onSelect(): void;
}

const SEGMENTS = 32;

/** Conexão dirigida: curva + seta no destino + partícula andando no sentido da chamada. */
function EdgeView({ edge, layout, highlighted, showLabel, label, onSelect }: EdgeViewProps) {
  const coneRef = useRef<THREE.Mesh>(null);
  const dotRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<THREE.Group>(null);
  const color = highlighted ? '#8ab4ff' : '#2a3347';

  const tmp = useMemo(
    () => ({
      curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()),
      dir: new THREE.Vector3(),
      perp: new THREE.Vector3(),
      p: new THREE.Vector3(),
      t: new THREE.Vector3(),
      phase: Math.random(),
    }),
    [],
  );

  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ transparent: true }));
  }, []);

  useEffect(() => {
    const m = line.material as THREE.LineBasicMaterial;
    m.color.set(color);
    m.opacity = highlighted ? 0.95 : 0.55;
  }, [line, color, highlighted]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  useFrame(({ clock }) => {
    const a = layout.position(edge.source);
    const b = layout.position(edge.target);
    if (!a || !b) return;
    const { curve, dir, perp, p, t } = tmp;
    curve.v0.set(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    curve.v2.set(b.x ?? 0, b.y ?? 0, b.z ?? 0);
    dir.subVectors(curve.v2, curve.v0);
    const len = dir.length();
    if (len < 1e-3) return;

    // Desvio perpendicular: arestas opostas (A→B e B→A) curvam para lados diferentes.
    perp.crossVectors(dir, UP);
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
    perp.normalize();
    curve.v1
      .copy(curve.v0)
      .add(curve.v2)
      .multiplyScalar(0.5)
      .addScaledVector(perp, len * (edge.hasReverse ? 0.18 : 0.06));

    const tStart = Math.min(0.45, (a.r + 0.15) / len);
    const tEnd = Math.max(0.55, 1 - (b.r + 0.2) / len);
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= SEGMENTS; i++) {
      curve.getPoint(tStart + ((tEnd - tStart) * i) / SEGMENTS, p);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();

    if (coneRef.current) {
      curve.getPoint(tEnd, p);
      curve.getTangent(tEnd, t);
      coneRef.current.position.copy(p).addScaledVector(t, -0.28);
      coneRef.current.quaternion.setFromUnitVectors(UP, t);
    }
    if (dotRef.current) {
      const phase = (clock.elapsedTime * 0.35 + tmp.phase) % 1;
      curve.getPoint(tStart + (tEnd - tStart) * phase, p);
      dotRef.current.position.copy(p);
    }
    if (labelRef.current) labelRef.current.position.copy(curve.getPoint(0.5, p));
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group>
      <primitive object={line} onClick={click} />
      <mesh ref={coneRef} onClick={click}>
        <coneGeometry args={[0.22, 0.56, 12]} />
        <meshBasicMaterial color={color} transparent opacity={highlighted ? 1 : 0.6} />
      </mesh>
      <mesh ref={dotRef} raycast={noRaycast}>
        <sphereGeometry args={[highlighted ? 0.12 : 0.08, 8, 8]} />
        <meshBasicMaterial color={highlighted ? '#ffffff' : '#56627c'} />
      </mesh>
      {showLabel && label && (
        <group ref={labelRef}>
          <Html center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div className="edge-label">{label}</div>
          </Html>
        </group>
      )}
    </group>
  );
}
