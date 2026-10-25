"use client";

import { Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GameEvent } from "@/lib/types";
import type { PackTheme } from "@/packs/types";

// Atmosphere only: the board itself is crisp HTML layered on top, so text is
// always sharp and the 3D can stay light enough for an old laptop on a TV.

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,240,200,1)");
  grad.addColorStop(0.25, "rgba(255,200,110,0.6)");
  grad.addColorStop(1, "rgba(255,160,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ------------------------------------------------------------ camera

function CameraRig({ shake }: { shake: number }) {
  const shakeUntil = useRef(0);
  useEffect(() => {
    if (shake) shakeUntil.current = performance.now() + 450;
  }, [shake]);
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    const jolt = performance.now() < shakeUntil.current ? 0.08 : 0;
    camera.position.x = Math.sin(t * 0.07) * 1.4 + (Math.random() - 0.5) * jolt;
    camera.position.y = 0.4 + Math.sin(t * 0.05) * 0.35 + (Math.random() - 0.5) * jolt;
    camera.position.z = 10 + Math.sin(t * 0.03) * 0.6;
    camera.lookAt(0, 1.6, -12);
  });
  return null;
}

/** A quick colored light flash + sparkle burst whenever something happens. */
function EventFx({ event, theme }: { event: GameEvent | null; theme: PackTheme }) {
  const light = useRef<THREE.PointLight>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const flash = useRef({ until: 0, color: new THREE.Color() });
  const good = !!event && ["hit", "steal_hit", "round_won", "game_over", "control"].includes(event.kind);
  const bad = !!event && ["miss", "dupe", "timeout", "steal_miss"].includes(event.kind);
  const burst = good && event && finished !== event.id ? event.id : null;

  const eventId = event?.id;
  useEffect(() => {
    if (!eventId || (!good && !bad)) return;
    flash.current = { until: performance.now() + 900, color: new THREE.Color(good ? theme.colors.accent : theme.colors.strike) };
    const t = setTimeout(() => setFinished(eventId), 2500);
    return () => clearTimeout(t);
  }, [eventId, good, bad, theme]);

  useFrame(() => {
    if (!light.current) return;
    const left = flash.current.until - performance.now();
    light.current.intensity = left > 0 ? (left / 900) * 60 : 0;
    light.current.color = flash.current.color;
  });

  return (
    <>
      <pointLight ref={light} position={[0, 2, 2]} distance={30} decay={1.5} intensity={0} />
      {burst && <Sparkles key={burst} count={140} scale={[10, 5, 4]} position={[0, 1.5, 0]} size={9} speed={2.2} color={theme.colors.accent} />}
    </>
  );
}

// ------------------------------------------------------------ great hall

function Candles({ count = 70 }: { count?: number }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const flames = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.Points>(null);
  const texture = useMemo(() => glowTexture(), []);
  const candles = useMemo(() => {
    const rand = seeded(7);
    return Array.from({ length: count }, () => ({
      x: (rand() - 0.5) * 34,
      y: 1 + rand() * 8,
      z: -24 + rand() * 24,
      h: 0.5 + rand() * 0.6,
      phase: rand() * Math.PI * 2,
      speed: 0.4 + rand() * 0.5,
    }));
  }, [count]);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    candles.forEach((c, i) => {
      const y = c.y + Math.sin(t * c.speed + c.phase) * 0.25;
      dummy.position.set(c.x, y, c.z);
      dummy.scale.set(1, c.h, 1);
      dummy.updateMatrix();
      bodies.current?.setMatrixAt(i, dummy.matrix);
      const fy = y + c.h * 0.5 + 0.09;
      const flicker = 0.85 + Math.sin(t * 17 + c.phase * 3) * 0.08 + Math.sin(t * 29 + c.phase) * 0.05;
      dummy.position.set(c.x, fy, c.z);
      dummy.scale.set(flicker, flicker * 1.6, flicker);
      dummy.updateMatrix();
      flames.current?.setMatrixAt(i, dummy.matrix);
      positions.set([c.x, fy, c.z], i * 3);
    });
    if (bodies.current) bodies.current.instanceMatrix.needsUpdate = true;
    if (flames.current) flames.current.instanceMatrix.needsUpdate = true;
    if (glow.current) glow.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, count]}>
        <cylinderGeometry args={[0.07, 0.08, 1, 10]} />
        <meshStandardMaterial color="#f1e6cc" emissive="#5a3a10" emissiveIntensity={0.5} roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={flames} args={[undefined, undefined, count]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial color="#ffd27a" toneMapped={false} />
      </instancedMesh>
      <points ref={glow}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={texture}
          size={1.4}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#ffc46b"
        />
      </points>
    </group>
  );
}

function Castle({ color }: { color: string }) {
  const towers = useMemo(() => {
    const rand = seeded(21);
    return Array.from({ length: 16 }, (_, i) => {
      const x = -26 + i * 3.5 + (rand() - 0.5) * 1.5;
      const center = 1 - Math.abs(x) / 30;
      return { x, h: 4 + rand() * 6 + center * 9, w: 1 + rand() * 1.4, z: -38 - rand() * 6, spire: rand() > 0.35 };
    });
  }, []);
  const windows = useMemo(() => {
    const rand = seeded(5);
    return towers.flatMap((t) =>
      Array.from({ length: Math.floor(t.h / 2) }, () => ({
        x: t.x + (rand() - 0.5) * t.w * 0.6,
        y: -4 + 1 + rand() * (t.h - 2),
        z: t.z + t.w / 2 + 0.01,
        on: rand() > 0.35,
      })).filter((w) => w.on),
    );
  }, [towers]);
  return (
    <group>
      {towers.map((t, i) => (
        <group key={i} position={[t.x, -4, t.z]}>
          <mesh position={[0, t.h / 2, 0]}>
            <boxGeometry args={[t.w, t.h, t.w]} />
            <meshStandardMaterial color={color} roughness={1} />
          </mesh>
          {t.spire && (
            <mesh position={[0, t.h + t.w * 0.9, 0]}>
              <coneGeometry args={[t.w * 0.75, t.w * 1.8, 4]} />
              <meshStandardMaterial color={color} roughness={1} />
            </mesh>
          )}
        </group>
      ))}
      {windows.map((w, i) => (
        <mesh key={i} position={[w.x, w.y, w.z]}>
          <planeGeometry args={[0.22, 0.38]} />
          <meshBasicMaterial color="#ffcb6b" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function GreatHall({ theme }: { theme: PackTheme }) {
  const stars = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (stars.current) stars.current.rotation.y += dt * 0.004;
  });
  return (
    <>
      <color attach="background" args={[theme.colors.bg]} />
      <fog attach="fog" args={[theme.colors.fog, 14, 52]} />
      <ambientLight intensity={0.35} color="#8a8cff" />
      <pointLight position={[-6, 6, 0]} intensity={30} color="#ffb35c" distance={30} />
      <pointLight position={[7, 5, -6]} intensity={25} color="#ffb35c" distance={30} />
      <group ref={stars}>
        <Stars radius={70} depth={40} count={4000} factor={4} saturation={0.2} fade speed={0.6} />
      </group>
      <Castle color="#0b0a1c" />
      <Candles />
      <Sparkles count={110} scale={[34, 12, 24]} position={[0, 3, -8]} size={3.5} speed={0.35} opacity={0.8} color={theme.colors.accent} />
    </>
  );
}

// ------------------------------------------------------------ studio

function Beams({ color }: { color: string }) {
  const group = useRef<THREE.Group>(null);
  const beams = useMemo(() => [-9, -5.5, -2, 2, 5.5, 9].map((x, i) => ({ x, phase: i * 1.3 })), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    group.current?.children.forEach((child, i) => {
      child.rotation.z = Math.sin(t * 0.5 + beams[i].phase) * 0.45;
      child.rotation.x = Math.cos(t * 0.35 + beams[i].phase) * 0.2;
    });
  });
  return (
    <group ref={group}>
      {beams.map((b, i) => (
        <group key={i} position={[b.x, 9, -6]}>
          <mesh position={[0, -6, 0]}>
            <coneGeometry args={[2.2, 12, 24, 1, true]} />
            <meshBasicMaterial
              color={i % 2 ? "#ffffff" : color}
              transparent
              opacity={0.07}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function MarqueeLights({ color }: { color: string }) {
  const count = 64;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const on = useMemo(() => new THREE.Color(color), [color]);
  const off = useMemo(() => new THREE.Color("#3a2a08"), []);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = Math.PI * (i / (count - 1));
      dummy.position.set(Math.cos(a) * 15, Math.sin(a) * 9 - 2, -14);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(i, dummy.matrix);
    }
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }) => {
    const step = Math.floor(clock.elapsedTime * 8);
    for (let i = 0; i < count; i++) mesh.current?.setColorAt(i, (i + step) % 4 === 0 ? on : off);
    if (mesh.current?.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.16, 10, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function Studio({ theme }: { theme: PackTheme }) {
  return (
    <>
      <color attach="background" args={[theme.colors.bg]} />
      <fog attach="fog" args={[theme.colors.fog, 12, 40]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 6, 4]} intensity={40} color={theme.colors.bgAlt} distance={40} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.5, -6]}>
        <planeGeometry args={[80, 60]} />
        <meshStandardMaterial color={theme.colors.bgAlt} metalness={0.7} roughness={0.35} />
      </mesh>
      <gridHelper args={[80, 40, theme.colors.accent, "#1b3a8a"]} position={[0, -3.48, -6]} />
      <MarqueeLights color={theme.colors.accent} />
      <Beams color={theme.colors.accent} />
      <Sparkles count={70} scale={[30, 10, 16]} position={[0, 2, -6]} size={3} speed={0.3} color={theme.colors.accent} />
    </>
  );
}

export default function Scene3D({ theme, event }: { theme: PackTheme; event: GameEvent | null }) {
  const shake = event && ["miss", "dupe", "timeout", "steal_miss"].includes(event.kind) ? event.at : 0;
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.4, 10], fov: 55 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      className="!absolute inset-0"
    >
      {theme.scene === "great-hall" ? <GreatHall theme={theme} /> : <Studio theme={theme} />}
      <CameraRig shake={shake} />
      <EventFx event={event} theme={theme} />
    </Canvas>
  );
}
