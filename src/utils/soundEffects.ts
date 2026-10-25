/**
 * soundEffects.ts
 * Tổng hợp âm thanh vật lí 100% bằng Web Audio API (Zero external MP3/WAV dependencies)
 * Tạo cảm giác chân thực khi gạt công tắc, nhả nam châm điện, tiếng bíp đồng hồ khi qua cổng quang và tiếng trụ thép chạm đệm hứng.
 */

class LabSoundEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Tiếng click cơ khí khi gạt công tắc hoặc nhấn nút đồng hồ */
  public playSwitchClick(pitch: number = 900) {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(pitch, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.035);

      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch {
      // Ignore audio errors on restricted policies
    }
  }

  /** Tiếng bíp điện tử ngắn khi đồng hồ RESET hoặc cổng quang điện bắt được trụ thép */
  public playTimerBeep(freq: number = 2400, duration: number = 0.065) {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.01);
    } catch {
      // Ignore
    }
  }

  /**
   * Tiếng va chạm vật lí chân thực khi trụ thép rơi đập vào đệm cao su khay hứng ở đáy giá đỡ:
   * Kết hợp 4 lớp âm học tổng hợp bằng Web Audio API:
   * 1. Âm trầm nén đệm cao su & truyền xung lực xuống đế gang (Low-frequency damped cushion thud)
   * 2. Xung va đập tức thời bề mặt đáy trụ thép – mặt đệm (Filtered broadband contact transient)
   * 3. Âm cộng hưởng kim loại đặc trưng của trụ thép và vành khay nhôm bị đệm cao su triệt tiêu nhanh (Damped metallic cup thock)
   * 4. Nhịp nảy vi mô (Micro-settle rebound ~45ms sau va chạm chính) khi trụ thép nằm ổn định trên đệm hứng
   */
  public playCatchTrayThud(impactSpeedMetersPerSec: number = 4.07) {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Chuẩn hóa cường độ theo vận tốc chạm đáy (mặc định rơi từ h ≈ 0.845m có v ≈ 4.07 m/s)
      const speedNorm = Math.max(0.35, Math.min(1.25, impactSpeedMetersPerSec / 4.07));
      const pitchShift = 0.92 + 0.12 * speedNorm;

      // Master compressor/waveshaper nhẹ qua GainNode tổng cho toàn bộ cú va chạm
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(Math.min(1.0, 0.9 * speedNorm), now);
      masterGain.connect(ctx.destination);

      // =======================================================================
      // LỚP 1: Âm trầm nén đệm cao su & đế giá đỡ (Primary Rubber Cushion Thud)
      // =======================================================================
      const thudOsc = ctx.createOscillator();
      const thudGain = ctx.createGain();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(162 * pitchShift, now);
      thudOsc.frequency.exponentialRampToValueAtTime(42, now + 0.085);
      thudOsc.frequency.exponentialRampToValueAtTime(31, now + 0.13);

      thudGain.gain.setValueAtTime(0.001, now);
      thudGain.gain.linearRampToValueAtTime(0.42, now + 0.0025);
      thudGain.gain.exponentialRampToValueAtTime(0.09, now + 0.055);
      thudGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.135);

      thudOsc.connect(thudGain);
      thudGain.connect(masterGain);
      thudOsc.start(now);
      thudOsc.stop(now + 0.14);

      // Lớp sub-body (độ nặng đầm của khối trụ thép truyền qua đệm)
      const subOsc = ctx.createOscillator();
      const subFilter = ctx.createBiquadFilter();
      const subGain = ctx.createGain();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(96 * pitchShift, now);
      subOsc.frequency.exponentialRampToValueAtTime(34, now + 0.095);

      subFilter.type = 'lowpass';
      subFilter.frequency.setValueAtTime(175, now);

      subGain.gain.setValueAtTime(0.001, now);
      subGain.gain.linearRampToValueAtTime(0.26, now + 0.003);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      subOsc.connect(subFilter);
      subFilter.connect(subGain);
      subGain.connect(masterGain);
      subOsc.start(now);
      subOsc.stop(now + 0.105);

      // =======================================================================
      // LỚP 2: Xung va đập tức thời mặt trụ thép chạm đệm (Surface Contact Slap)
      // =======================================================================
      const impulseDuration = 0.032;
      const impulseLen = Math.max(1, Math.floor(ctx.sampleRate * impulseDuration));
      const impulseBuffer = ctx.createBuffer(1, impulseLen, ctx.sampleRate);
      const data = impulseBuffer.getChannelData(0);
      for (let i = 0; i < impulseLen; i++) {
        const tNorm = i / impulseLen;
        // Hàm bao suy giảm nhanh mô phỏng xung va chạm đàn hồi - nhớt của cao su đặc
        const env = Math.pow(1 - tNorm, 3.2);
        data[i] = (Math.random() * 2 - 1) * env;
      }

      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = impulseBuffer;

      const slapBandpass = ctx.createBiquadFilter();
      slapBandpass.type = 'bandpass';
      slapBandpass.frequency.setValueAtTime(560 * pitchShift, now);
      slapBandpass.Q.setValueAtTime(1.45, now);

      const slapGain = ctx.createGain();
      slapGain.gain.setValueAtTime(0.36, now);
      slapGain.gain.exponentialRampToValueAtTime(0.001, now + impulseDuration);

      noiseSrc.connect(slapBandpass);
      slapBandpass.connect(slapGain);
      slapGain.connect(masterGain);
      noiseSrc.start(now);
      noiseSrc.stop(now + impulseDuration + 0.005);

      // =======================================================================
      // LỚP 3: Âm cộng hưởng kim loại bị triệt tiêu nhanh (Damped Steel & Cup Modal Thock)
      // =======================================================================
      // Mode 3A: Cộng hưởng thành khay nhôm đúc có lót đệm ( ~330 Hz -> 255 Hz )
      const cupOsc = ctx.createOscillator();
      const cupGain = ctx.createGain();
      cupOsc.type = 'triangle';
      cupOsc.frequency.setValueAtTime(335 * pitchShift, now);
      cupOsc.frequency.exponentialRampToValueAtTime(248, now + 0.048);

      cupGain.gain.setValueAtTime(0.16, now);
      cupGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      cupOsc.connect(cupGain);
      cupGain.connect(masterGain);
      cupOsc.start(now);
      cupOsc.stop(now + 0.055);

      // Mode 3B: Họa âm đanh ngắn của khối trụ thép đặc khi va chạm (~1180 Hz -> 890 Hz)
      const steelPingOsc = ctx.createOscillator();
      const steelPingGain = ctx.createGain();
      steelPingOsc.type = 'sine';
      steelPingOsc.frequency.setValueAtTime(1180 * pitchShift, now);
      steelPingOsc.frequency.exponentialRampToValueAtTime(880, now + 0.022);

      steelPingGain.gain.setValueAtTime(0.055 * speedNorm, now);
      steelPingGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.024);

      steelPingOsc.connect(steelPingGain);
      steelPingGain.connect(masterGain);
      steelPingOsc.start(now);
      steelPingOsc.stop(now + 0.028);

      // =======================================================================
      // LỚP 4: Nhịp nảy vi mô khi trụ thép ổn định trên đệm (Micro-Rebound Settle)
      // =======================================================================
      if (speedNorm >= 0.55) {
        const settleDelay = 0.044;
        const tSettle = now + settleDelay;

        const settleOsc = ctx.createOscillator();
        const settleGain = ctx.createGain();
        settleOsc.type = 'sine';
        settleOsc.frequency.setValueAtTime(124 * pitchShift, tSettle);
        settleOsc.frequency.exponentialRampToValueAtTime(38, tSettle + 0.058);

        settleGain.gain.setValueAtTime(0.0001, now);
        settleGain.gain.setValueAtTime(0.001, tSettle);
        settleGain.gain.linearRampToValueAtTime(0.11 * speedNorm, tSettle + 0.002);
        settleGain.gain.exponentialRampToValueAtTime(0.0008, tSettle + 0.062);

        settleOsc.connect(settleGain);
        settleGain.connect(masterGain);
        settleOsc.start(tSettle);
        settleOsc.stop(tSettle + 0.066);

        const settleMetalOsc = ctx.createOscillator();
        const settleMetalGain = ctx.createGain();
        settleMetalOsc.type = 'triangle';
        settleMetalOsc.frequency.setValueAtTime(285 * pitchShift, tSettle);
        settleMetalOsc.frequency.exponentialRampToValueAtTime(215, tSettle + 0.028);

        settleMetalGain.gain.setValueAtTime(0.0001, now);
        settleMetalGain.gain.setValueAtTime(0.038 * speedNorm, tSettle);
        settleMetalGain.gain.exponentialRampToValueAtTime(0.0008, tSettle + 0.03);

        settleMetalOsc.connect(settleMetalGain);
        settleMetalGain.connect(masterGain);
        settleMetalOsc.start(tSettle);
        settleMetalOsc.stop(tSettle + 0.034);
      }
    } catch {
      // Ignore
    }
  }

  /** Tiếng cảnh báo khi thao tác sai quy trình */
  public playErrorTone() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.setValueAtTime(240, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    } catch {
      // Ignore
    }
  }
}

export const labSound = new LabSoundEngine();

