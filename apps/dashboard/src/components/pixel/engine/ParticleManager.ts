export type ParticleType = 'dust' | 'token' | 'sparkle' | 'error' | 'steam' | 'cache';

const MAX_PARTICLES = 500;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: ParticleType;
}

function createParticle(type: ParticleType, x: number, y: number): Particle {
  const p: Particle = { x, y, vx: 0, vy: 0, life: 1, maxLife: 1, size: 1, color: '#fff', type };

  switch (type) {
    case 'dust':
      p.vx = (Math.random() - 0.5) * 10;
      p.vy = -Math.random() * 8 - 2;
      p.maxLife = 0.4 + Math.random() * 0.2;
      p.size = 1;
      p.color = '#b0a090';
      break;
    case 'token':
      p.vx = (Math.random() - 0.5) * 20;
      p.vy = -Math.random() * 30 - 15;
      p.maxLife = 1.0 + Math.random() * 0.5;
      p.size = 2;
      p.color = Math.random() > 0.5 ? '#ffd700' : '#ffa500';
      break;
    case 'sparkle':
      p.vx = (Math.random() - 0.5) * 30;
      p.vy = (Math.random() - 0.5) * 30;
      p.maxLife = 0.3 + Math.random() * 0.3;
      p.size = 1 + Math.floor(Math.random() * 2);
      p.color = '#ffffaa';
      break;
    case 'error':
      p.vx = (Math.random() - 0.5) * 15;
      p.vy = -Math.random() * 20 - 10;
      p.maxLife = 0.6 + Math.random() * 0.3;
      p.size = 2;
      p.color = '#ff4444';
      break;
    case 'steam':
      p.vx = (Math.random() - 0.5) * 3;
      p.vy = -Math.random() * 8 - 4;
      p.maxLife = 1.5 + Math.random() * 0.5;
      p.size = 2 + Math.floor(Math.random() * 2);
      p.color = 'rgba(200,200,200,0.35)';
      break;
    case 'cache':
      p.vx = (Math.random() - 0.5) * 8;
      p.vy = -Math.random() * 12 - 5;
      p.maxLife = 0.5;
      p.size = 1;
      p.color = '#55ffaa';
      break;
  }

  p.life = p.maxLife;
  return p;
}

export class ParticleManager {
  private particles: Particle[] = [];

  get count(): number { return this.particles.length; }

  getParticles(): Particle[] { return this.particles; }

  emit(type: ParticleType, x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      this.particles.push(createParticle(type, x, y));
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Swap with last and pop
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Gravity for token and error
      if (p.type === 'token' || p.type === 'error') p.vy += 20 * dt;
      // Steam drift
      if (p.type === 'steam') p.vx += (Math.random() - 0.5) * 2;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
