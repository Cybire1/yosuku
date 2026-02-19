'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

/* ─── Types ─── */
interface OrbProps {
  mouse: { x: number; y: number };
  tier: 'high' | 'medium';
}

/* ─── Inner glow sphere ─── */
function InnerGlow() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const s = 0.92 + Math.sin(t * 1.2) * 0.04;
    ref.current.scale.set(s, s, s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(t * 0.8) * 0.04;
  });

  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.35, 3]} />
      <meshBasicMaterial color="#34D399" transparent opacity={0.12} side={THREE.BackSide} />
    </mesh>
  );
}

/* ─── Orbiting particles inside the crystal ─── */
function InternalParticles({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo(() => {
    const arr = [];
    const colors = [
      new THREE.Color('#34D399'), // mint
      new THREE.Color('#60A5FA'), // blue
      new THREE.Color('#F472B6'), // pink
    ];
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.3 + Math.random() * 0.9;
      arr.push({
        radius: r,
        theta,
        phi,
        speed: 0.15 + Math.random() * 0.35,
        offset: Math.random() * Math.PI * 2,
        color: colors[i % 3],
        scale: 0.015 + Math.random() * 0.025,
      });
    }
    return arr;
  }, [count]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const angle = t * p.speed + p.offset;
      const x = p.radius * Math.sin(p.phi + angle * 0.3) * Math.cos(p.theta + angle);
      const y = p.radius * Math.sin(p.phi + angle * 0.3) * Math.sin(p.theta + angle);
      const z = p.radius * Math.cos(p.phi + angle * 0.3);

      dummy.position.set(x, y, z);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, p.color);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/* ─── Crystal orb shell ─── */
function CrystalOrb({ mouse, tier }: OrbProps) {
  const groupRef = useRef<THREE.Group>(null);
  const targetRotation = useRef({ x: 0, y: 0 });

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Mouse-reactive tilt (spring interpolation)
    targetRotation.current.x = -mouse.y * 0.3;
    targetRotation.current.y = mouse.x * 0.3;

    groupRef.current.rotation.x += (targetRotation.current.x - groupRef.current.rotation.x) * delta * 2;
    groupRef.current.rotation.y += (targetRotation.current.y - groupRef.current.rotation.y) * delta * 2;

    // Slow auto-rotation
    groupRef.current.rotation.z += delta * 0.08;
  });

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.5}>
      <group ref={groupRef}>
        {/* Crystal shell */}
        <mesh>
          <icosahedronGeometry args={[1.5, 4]} />
          {tier === 'high' ? (
            <meshPhysicalMaterial
              transmission={0.95}
              thickness={1.5}
              roughness={0.05}
              ior={2.2}
              color="#34D399"
              transparent
              opacity={0.35}
              envMapIntensity={1.5}
              metalness={0.05}
              clearcoat={1}
              clearcoatRoughness={0.1}
              attenuationColor="#34D399"
              attenuationDistance={2}
              specularIntensity={0.8}
              sheen={0.3}
              sheenColor="#60A5FA"
            />
          ) : (
            <meshPhysicalMaterial
              transmission={0.9}
              thickness={1}
              roughness={0.1}
              ior={1.8}
              color="#34D399"
              transparent
              opacity={0.3}
              envMapIntensity={1}
              metalness={0}
              clearcoat={1}
            />
          )}
        </mesh>

        {/* Inner glow */}
        <InnerGlow />

        {/* Particles orbiting inside */}
        <InternalParticles count={tier === 'high' ? 150 : 50} />
      </group>
    </Float>
  );
}

/* ─── Scene ─── */
function Scene({ mouse, tier }: OrbProps) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <pointLight position={[-3, 2, 2]} color="#34D399" intensity={2} distance={8} />
      <pointLight position={[3, -2, -2]} color="#60A5FA" intensity={2} distance={8} />

      <CrystalOrb mouse={mouse} tier={tier} />

      <Environment preset="city" />

      {tier === 'high' && (
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            intensity={0.6}
            mipmapBlur
          />
        </EffectComposer>
      )}
    </>
  );
}

/* ─── Exported Canvas Wrapper ─── */
export default function PredictionOrb({ mouse, tier }: OrbProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 45 }}
      dpr={tier === 'high' ? [1, 2] : [1, 1]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      }}
      style={{ pointerEvents: 'none' }}
    >
      <Scene mouse={mouse} tier={tier} />
    </Canvas>
  );
}
