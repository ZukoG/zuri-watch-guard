// The animated background. A glowing core (the assistant) sits inside an energy
// shield (the Guard plus our layer). Messages stream in from every direction:
// harmless ones (cyan) pass through, attacks (red) hit the shield, ripple it and
// bounce off. Orbiting rings stand in for the language layer. The page fires
// "zuri:verdict" and "zuri:busy" events so the scene reacts to real results.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const canvas = document.getElementById("scene");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const motion = reduceMotion ? 0.15 : 1;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x04070d, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04070d, 0.035);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(0, 0, 11);

const world = new THREE.Group();
scene.add(world);

const GREEN = new THREE.Color(0x4ade80);
const CYAN = new THREE.Color(0x67e8f9);
const RED = new THREE.Color(0xf87171);
const SHIELD_RADIUS = 3.2;

// ---------- Core ----------

const core = new THREE.Group();
const coreWire = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.05, 1),
  new THREE.MeshBasicMaterial({ color: GREEN, wireframe: true, transparent: true, opacity: 0.9 })
);
const coreInner = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.62, 0),
  new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.55 })
);
const coreGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xd9ffe6 })
);
core.add(coreWire, coreInner, coreGlow);
world.add(core);

// ---------- Shield ----------

const MAX_HITS = 8;
const hits = Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 1, 0, -100));
let nextHit = 0;

const shieldMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: {
    uTime: { value: 0 },
    uHits: { value: hits },
    uBase: { value: GREEN.clone() },
    uHitColor: { value: RED.clone() },
    uPulse: { value: 0 },
    uPulseColor: { value: GREEN.clone() },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    varying vec3 vViewNormal;
    varying vec3 vViewPos;
    void main() {
      vDir = normalize(position);
      vViewNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec4 uHits[${MAX_HITS}];
    uniform vec3 uBase;
    uniform vec3 uHitColor;
    uniform float uPulse;
    uniform vec3 uPulseColor;
    varying vec3 vDir;
    varying vec3 vViewNormal;
    varying vec3 vViewPos;

    void main() {
      vec3 viewDir = normalize(-vViewPos);
      float fres = pow(1.0 - abs(dot(normalize(vViewNormal), viewDir)), 2.6);

      // Hexagon-ish lattice from spherical coordinates, faint and shimmering.
      float lat = asin(vDir.y);
      float lon = atan(vDir.z, vDir.x);
      float grid = max(
        smoothstep(0.92, 1.0, abs(sin(lat * 14.0))),
        smoothstep(0.92, 1.0, abs(sin(lon * 14.0 + lat * 6.0)))
      );
      float scan = smoothstep(0.0, 1.0, sin(vDir.y * 9.0 - uTime * 1.4) * 0.5 + 0.5) * 0.25;

      float ripple = 0.0;
      for (int i = 0; i < ${MAX_HITS}; i++) {
        float age = uTime - uHits[i].w;
        if (age > 0.0 && age < 1.6) {
          float ang = acos(clamp(dot(vDir, normalize(uHits[i].xyz)), -1.0, 1.0));
          float ring = exp(-pow((ang - age * 1.5) * 9.0, 2.0));
          float flash = exp(-ang * 7.0) * exp(-age * 5.0) * 2.0;
          ripple += (ring + flash) * (1.0 - age / 1.6);
        }
      }

      vec3 col = uBase * (fres * 0.55 + grid * 0.12 + scan * fres);
      col += uHitColor * ripple * 1.4;
      col += uPulseColor * uPulse * (0.08 + fres * 0.7);
      float alpha = clamp(fres * 0.5 + grid * 0.08 + ripple + uPulse * fres * 0.5, 0.0, 1.0);
      gl_FragColor = vec4(col, alpha);
    }
  `,
});

const shield = new THREE.Mesh(new THREE.SphereGeometry(SHIELD_RADIUS, 96, 64), shieldMaterial);
world.add(shield);

function registerHit(direction) {
  hits[nextHit].set(direction.x, direction.y, direction.z, shieldMaterial.uniforms.uTime.value);
  nextHit = (nextHit + 1) % MAX_HITS;
}

// ---------- Language rings ----------

const rings = [];
const ringSpecs = [
  { radius: 4.3, tilt: [1.2, 0.2, 0], speed: 0.18, color: CYAN },
  { radius: 4.8, tilt: [0.4, 1.0, 0.3], speed: -0.12, color: GREEN },
  { radius: 5.4, tilt: [1.9, -0.5, 0.6], speed: 0.09, color: 0x60a5fa },
];
for (const spec of ringSpecs) {
  const pivot = new THREE.Group();
  pivot.rotation.set(...spec.tilt);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(spec.radius, 0.008, 6, 220),
    new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.35 })
  );
  pivot.add(ring);
  const nodes = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 12),
      new THREE.MeshBasicMaterial({ color: spec.color })
    );
    const a = (i / 3) * Math.PI * 2;
    node.position.set(Math.cos(a) * spec.radius, Math.sin(a) * spec.radius, 0);
    nodes.add(node);
  }
  pivot.add(nodes);
  world.add(pivot);
  rings.push({ nodes, speed: spec.speed });
}

// ---------- Message particles ----------

function dotTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.8)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const sprite = dotTexture();

const COUNT = window.innerWidth < 720 ? 90 : 170;
const positions = new Float32Array(COUNT * 3);
const colors = new Float32Array(COUNT * 3);
const particles = Array.from({ length: COUNT }, () => ({
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  attack: false,
  state: "in",
  fade: 1,
}));

const tmp = new THREE.Vector3();
let attackRate = 0.3;

function spawn(p, initial) {
  tmp.randomDirection();
  const dist = initial ? THREE.MathUtils.randFloat(5, 24) : THREE.MathUtils.randFloat(16, 26);
  p.pos.copy(tmp).multiplyScalar(dist);
  const target = new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * 1.6);
  p.vel.copy(target).sub(p.pos).normalize().multiplyScalar(THREE.MathUtils.randFloat(1.6, 3.4));
  p.attack = Math.random() < attackRate;
  p.state = "in";
  p.fade = initial ? 1 : 0;
  // Spawned inside the shield on first load? Push it back out so it enters properly.
  if (p.pos.length() < SHIELD_RADIUS + 0.5) p.pos.setLength(SHIELD_RADIUS + 6);
}
particles.forEach((p) => spawn(p, true));

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
const particlePoints = new THREE.Points(
  particleGeometry,
  new THREE.PointsMaterial({
    size: 0.22,
    map: sprite,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
world.add(particlePoints);

function updateParticles(dt) {
  for (let i = 0; i < COUNT; i++) {
    const p = particles[i];
    p.pos.addScaledVector(p.vel, dt);
    const r = p.pos.length();

    if (p.state === "in") {
      p.fade = Math.min(1, p.fade + dt * 0.8);
      if (p.attack && r < SHIELD_RADIUS) {
        // Bounce off the shield: reflect the velocity about the surface normal.
        tmp.copy(p.pos).normalize();
        registerHit(tmp);
        p.pos.copy(tmp).multiplyScalar(SHIELD_RADIUS + 0.02);
        p.vel.addScaledVector(tmp, -2 * p.vel.dot(tmp)).multiplyScalar(0.9);
        p.state = "out";
      } else if (!p.attack && r < 0.9) {
        p.state = "absorbed";
      }
    } else {
      p.fade -= dt * (p.state === "absorbed" ? 4 : 0.6);
      if (p.fade <= 0) spawn(p, false);
    }

    let c = p.attack ? RED : CYAN;
    if (!p.attack && r < SHIELD_RADIUS) c = GREEN;
    const f = Math.max(0, p.fade);
    positions[i * 3] = p.pos.x;
    positions[i * 3 + 1] = p.pos.y;
    positions[i * 3 + 2] = p.pos.z;
    colors[i * 3] = c.r * f;
    colors[i * 3 + 1] = c.g * f;
    colors[i * 3 + 2] = c.b * f;
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.color.needsUpdate = true;
}

// ---------- Stars ----------

const starCount = 1400;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  tmp.randomDirection().multiplyScalar(THREE.MathUtils.randFloat(40, 90));
  starPos.set([tmp.x, tmp.y, tmp.z], i * 3);
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({ size: 0.35, map: sprite, color: 0x7d93b5, transparent: true, opacity: 0.7, depthWrite: false })
);
scene.add(stars);

// ---------- Post-processing ----------

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.12);
composer.addPass(bloom);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // Pull back on narrow screens so the shield still fits.
  camera.position.z = w < 720 ? 15 : 11;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Interaction ----------

const pointer = new THREE.Vector2();
window.addEventListener("pointermove", (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
});

let busy = false;
let pulse = 0;

window.addEventListener("zuri:busy", (e) => {
  busy = !!e.detail;
});

window.addEventListener("zuri:verdict", (e) => {
  const blocked = e.detail === "blocked";
  shieldMaterial.uniforms.uPulseColor.value.copy(blocked ? RED : GREEN);
  pulse = 1;
  if (blocked) {
    // A burst of hits all over the shield, and more attacks in the stream for a while.
    for (let i = 0; i < 4; i++) registerHit(tmp.randomDirection().clone());
    attackRate = 0.65;
    setTimeout(() => (attackRate = 0.3), 4000);
  }
});

// ---------- Loop ----------

const clock = new THREE.Clock();
let spin = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05) * motion;
  const t = (shieldMaterial.uniforms.uTime.value += dt);

  spin += dt * (busy ? 2.2 : 0.35);
  core.rotation.set(spin * 0.6, spin, 0);
  coreInner.rotation.set(-spin * 1.3, 0, spin * 0.8);
  const breathe = 1 + Math.sin(t * 1.6) * 0.04 + pulse * 0.12;
  core.scale.setScalar(breathe);
  shield.rotation.y = t * 0.05;

  for (const ring of rings) ring.nodes.rotation.z += dt * ring.speed * (busy ? 4 : 1);

  pulse = Math.max(0, pulse - dt * 0.9);
  shieldMaterial.uniforms.uPulse.value = pulse;
  bloom.strength = 0.85 + pulse * 0.25 + (busy ? 0.15 : 0);

  updateParticles(dt);

  // Parallax towards the pointer, and drift the scene up as the page scrolls.
  const scroll = Math.min(window.scrollY / window.innerHeight, 1.5);
  world.rotation.x += (pointer.y * 0.25 - world.rotation.x) * 0.04;
  world.rotation.y += (pointer.x * 0.35 - world.rotation.y) * 0.04;
  world.position.y = 0.6 + scroll * 2.5;
  stars.rotation.y = t * 0.004;

  composer.render();
  requestAnimationFrame(frame);
}
frame();
