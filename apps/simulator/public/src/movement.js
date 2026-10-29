/** Circle-versus-axis-aligned-box collision in the ground plane. */
export function blocked(x, z, boxes, radius = 0.32) {
  if (x < -22 || x > 25 || z < -28 || z > 31) return true;
  return boxes.some(b => {
    const dx = x - Math.max(b.minX, Math.min(b.maxX, x));
    const dz = z - Math.max(b.minZ, Math.min(b.maxZ, z));
    return dx * dx + dz * dz < radius * radius;
  });
}

/** Small substeps prevent tunnelling; axis separation allows sliding along walls. */
export function move(position, dx, dz, boxes) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  let { x, z } = position;
  for (let i = 0; i < steps; i++) {
    if (!blocked(x + dx / steps, z, boxes)) x += dx / steps;
    if (!blocked(x, z + dz / steps, boxes)) z += dz / steps;
  }
  return { x, z };
}

export function vehicleZ(now, startedAt, openedAt) {
  if (openedAt) return 6 - Math.max(0, now - openedAt - 1800) / 1000 * 3.5;
  return 6 + Math.max(0, 1 - (now - startedAt) / 4500) * 22;
}

export function barrierAngle(now, openedAt) {
  if (!openedAt) return 0;
  const t = now - openedAt;
  const fraction = t < 1600 ? t / 1600 : t < 10500 ? 1 : 1 - (t - 10500) / 1600;
  return Math.max(0, Math.min(1, fraction)) * Math.PI * 0.47;
}
