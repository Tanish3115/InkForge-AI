"""Fine-tune actual DiffusionPen denoising weights using five-shot IAM style conditioning."""
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import torch
from torch.utils.data import DataLoader
from diffusers import DDIMScheduler
from server.model import DiffusionPen
from dataset import SynthesisDataset

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--train', required=True); p.add_argument('--validation', required=True); p.add_argument('--output', default='research/runs/synthesis'); p.add_argument('--epochs', type=int, default=2); p.add_argument('--batch-size', type=int, default=1); p.add_argument('--accumulation', type=int, default=4); p.add_argument('--max-train', type=int); p.add_argument('--max-validation', type=int); p.add_argument('--learning-rate', type=float, default=1e-5); p.add_argument('--patience', type=int, default=2); p.add_argument('--checkpoint'); p.add_argument('--resume'); a = p.parse_args()
    if min(a.epochs, a.batch_size, a.accumulation, a.patience) < 1: raise ValueError('Training counts must be positive.')
    torch.manual_seed(42); train = SynthesisDataset(a.train, limit=a.max_train); val = SynthesisDataset(a.validation, limit=a.max_validation)
    if set(train.writers) & set(val.writers): raise ValueError('Training and validation writers overlap.')
    model = DiffusionPen(a.checkpoint); scheduler = DDIMScheduler.from_config(model.scheduler_config)
    parameters = [v for v in model.unet.parameters() if v.requires_grad]; optimizer = torch.optim.AdamW(parameters, lr=a.learning_rate)
    scaler = torch.amp.GradScaler('cuda', enabled=model.device.type == 'cuda')
    out = Path(a.output); out.mkdir(parents=True, exist_ok=True); history = []; first = 0; best = float('inf'); stale = 0
    if a.resume:
        state = torch.load(a.resume, map_location='cpu', weights_only=True); optimizer.load_state_dict(state['optimizer']); scaler.load_state_dict(state['scaler']); history = state['history']; first = state['epoch']; best = state['best']; stale = state['stale']
    (out / 'config.json').write_text(json.dumps({**vars(a), 'device': str(model.device), 'train_ids': [r['id'] for r in train.rows], 'validation_ids': [r['id'] for r in val.rows], 'pretraining_overlap': True}, indent=2))
    def loss(batch, generator=None):
        images = batch['image'].to(model.device); style = batch['style'].to(model.device).reshape(-1, 3, 64, 256)
        with torch.no_grad():
            latents = model.vae.encode(images).latent_dist.mode() * .18215
            features = model.style(style)
            tokens = model.tokenizer(batch['text'], padding='max_length', max_length=40, return_tensors='pt').to(model.device)
            context = model.unet.text_encoder(**tokens).last_hidden_state
            noise = torch.randn(latents.shape, device=model.device, generator=generator)
            times = torch.randint(0, scheduler.config.num_train_timesteps, (images.shape[0],), device=model.device, generator=generator)
            noisy = scheduler.add_noise(latents, noise, times)
        predicted = model.unet(noisy, timesteps=times, context=context, style_extractor=features)
        return torch.nn.functional.mse_loss(predicted.float(), noise.float())
    for epoch in range(first, a.epochs):
        started = time.perf_counter(); model.unet.train(); model.unet.text_encoder.eval(); optimizer.zero_grad(set_to_none=True); total = 0
        loader = DataLoader(train, batch_size=a.batch_size, shuffle=True, num_workers=0)
        for step, batch in enumerate(loader):
            with torch.autocast(device_type=model.device.type, dtype=torch.float16, enabled=model.device.type == 'cuda'): value = loss(batch)
            total += value.item() * len(batch['text']); window = min(a.accumulation, len(loader) - step // a.accumulation * a.accumulation); scaler.scale(value / window).backward()
            if (step + 1) % a.accumulation == 0 or step + 1 == len(loader):
                scaler.unscale_(optimizer); torch.nn.utils.clip_grad_norm_(parameters, 1); scaler.step(optimizer); scaler.update(); optimizer.zero_grad(set_to_none=True)
            print(json.dumps({'epoch': epoch + 1, 'batch': step + 1, 'denoising_loss': value.item()}), flush=True)
        model.unet.eval(); valid = 0; generator = torch.Generator(device=model.device).manual_seed(741)
        with torch.inference_mode():
            for batch in DataLoader(val, batch_size=a.batch_size, num_workers=0): valid += loss(batch, generator).item() * len(batch['text'])
        record = {'epoch': epoch + 1, 'training_loss': total / len(train), 'validation_loss': valid / len(val), 'seconds': time.perf_counter() - started}; history.append(record)
        if record['validation_loss'] < best: best = record['validation_loss']; stale = 0; torch.save(model.unet.state_dict(), out / 'best.pt')
        else: stale += 1
        torch.save(model.unet.state_dict(), out / 'last-weights.pt'); torch.save({'optimizer': optimizer.state_dict(), 'scaler': scaler.state_dict(), 'history': history, 'epoch': epoch + 1, 'best': best, 'stale': stale}, out / 'resume.pt')
        (out / 'history.json').write_text(json.dumps(history, indent=2)); print(json.dumps(record), flush=True)
        if stale >= a.patience: break
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axis = plt.subplots(figsize=(7, 4)); x = [r['epoch'] for r in history]
    for key in ['training_loss', 'validation_loss']: axis.plot(x, [r[key] for r in history], 'o-', label=key.replace('_', ' '))
    axis.set(xlabel='Epoch', ylabel='Denoising MSE', title='Actual DiffusionPen fine-tuning losses'); axis.legend(); fig.tight_layout(); fig.savefig(out / 'loss.png', dpi=180); plt.close(fig)

if __name__ == '__main__': main()
