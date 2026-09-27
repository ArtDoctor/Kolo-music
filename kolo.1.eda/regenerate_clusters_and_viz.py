"""Cluster the audio library and regenerate static and interactive projections."""

import json
from pathlib import Path
import re
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.colors as mcolors  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.cluster import KMeans  # noqa: E402
from sklearn.manifold import TSNE  # noqa: E402
import umap  # noqa: E402

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "kolo.0.data"
EDA_DIR = ROOT_DIR / "kolo.1.eda"
RES_DIR = EDA_DIR / "res"
RES_DIR.mkdir(parents=True, exist_ok=True)
APP_DIR = ROOT_DIR / "kolo.3.app"

ALL_EMB_PATH = DATA_DIR / ".kolo" / "all_embeddings.npz"
if not ALL_EMB_PATH.exists():
    raise FileNotFoundError(f"Missing {ALL_EMB_PATH}")

print(f"[*] Loading all embeddings from: {ALL_EMB_PATH}")
data = np.load(ALL_EMB_PATH)
ids = data["ids"]
X = data["embeddings"]
durations = data["durations"]
print(f"[*] Loaded {len(ids)} tracks (512-dim).")

# Distinguish user library tracks vs negative dataset
mask_user = np.array([not tid.startswith("neg/") for tid in ids])
X_user = X[mask_user]
ids_user = ids[mask_user]
durs_user = durations[mask_user]
print(f"[*] User library tracks: {len(ids_user)}, Negative tracks: {np.sum(~mask_user)}")

# Mean-center with respect to the user library, then project to the unit sphere.
mean_user = np.mean(X_user, axis=0, keepdims=True)
centered = X - mean_user
norms = np.linalg.norm(centered, axis=1, keepdims=True)
X_norm = centered / np.maximum(norms, np.finfo(centered.dtype).eps)
X_user_norm = X_norm[mask_user]

# Six labels and colors chosen for the current library and interface.
K = 6
km = KMeans(n_clusters=K, random_state=42, n_init=50)
km.fit(X_user_norm)
all_labels = km.predict(X_norm)

GENRE_CLUSTERS: list[dict[str, Any]] = [
    {
        "id": 0,
        "name": "Cinematic Ambient & Neoclassical OST",
        "color": "#d4d4d0",
        "desc": "Atmospheric strings, reflective piano, dramatic soundscapes and OSTs",
    },
    {
        "id": 1,
        "name": "Atmospheric Indie & Dream Pop",
        "color": "#a3a39e",
        "desc": "Dreamy guitars, introspective vocals, warm melancholic indie vibes",
    },
    {
        "id": 2,
        "name": "Indie Dance & Synth-Rock",
        "color": "#73736e",
        "desc": "Punchy synth hooks, danceable grooves, upbeat indie-pop & synthwave",
    },
    {
        "id": 3,
        "name": "Dark Alt-Pop & Trap-Rock",
        "color": "#484844",
        "desc": "Gritty electro-rock, heavy 808 bass, dark alternative pop anthems",
    },
    {
        "id": 4,
        "name": "British Garage Indie & Alt-Rock (Lovejoy / Wilbur)",
        "color": "#0d8275",
        "desc": "Overdriven telecasters, punchy British indie rock, Lovejoy, Wilbur & Arctic Monkeys energy",
    },
    {
        "id": 5,
        "name": "Drift Phonk & Bass House",
        "color": "#ffffff",
        "desc": "Aggressive cowbells, distorted drift 808s, high-octane club & phonk",
    },
]

CLUSTER_NAMES: dict[int, str] = {int(g["id"]): str(g["name"]) for g in GENRE_CLUSTERS}
CLUSTER_PALETTE: dict[int, str] = {int(g["id"]): str(g["color"]) for g in GENRE_CLUSTERS}

# Write .kolo/clusters.json
clusters_json_data: dict[str, Any] = {
    "genres": GENRE_CLUSTERS,
    "tracks": {}
}

for i, tid in enumerate(ids):
    c = int(all_labels[i])
    clusters_json_data["tracks"][str(tid)] = {
        "cluster": c,
        "genre": CLUSTER_NAMES[c],
        "color": CLUSTER_PALETTE[c],
    }

clusters_json_path = DATA_DIR / ".kolo" / "clusters.json"
with open(clusters_json_path, "w", encoding="utf-8") as f:
    json.dump(clusters_json_data, f, indent=2)
print(f"[+] Saved updated clusters to: {clusters_json_path} ({len(clusters_json_data['tracks'])} tracks)")


# Clean title helper
def clean_title(fname: str) -> str:
    base = Path(fname).stem
    base = re.sub(r"\[.*?\]|\(.*?\)", "", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base[:35]


# Computing 2D and 3D projections on user library tracks
print("[*] Computing 3D t-SNE...")
tsne_3d = TSNE(n_components=3, perplexity=28, metric="cosine", random_state=42, max_iter=1200)
coords_3d_tsne = tsne_3d.fit_transform(X_user_norm)

print("[*] Computing 3D UMAP...")
umap_3d = umap.UMAP(n_components=3, n_neighbors=15, min_dist=0.08, metric="cosine", random_state=42)
coords_3d_umap = umap_3d.fit_transform(X_user_norm)

print("[*] Computing 2D t-SNE...")
tsne_2d = TSNE(n_components=2, perplexity=28, metric="cosine", random_state=42, max_iter=1200)
coords_2d_tsne = tsne_2d.fit_transform(X_user_norm)

print("[*] Computing 2D UMAP...")
umap_2d = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.08, metric="cosine", random_state=42)
coords_2d_umap = umap_2d.fit_transform(X_user_norm)

user_cluster_labels = all_labels[mask_user]

# Render 2D PNGs
fig, ax = plt.subplots(figsize=(15, 11), facecolor="#080808")
ax.set_facecolor("#080808")
ax.grid(True, color="#1c1c1c", linestyle="--", linewidth=0.5, alpha=0.6)

for k in range(K):
    idx_k = (user_cluster_labels == k)
    ax.scatter(
        coords_2d_tsne[idx_k, 0],
        coords_2d_tsne[idx_k, 1],
        c=CLUSTER_PALETTE[k],
        label=f"{CLUSTER_NAMES[k]} ({np.sum(idx_k)})",
        alpha=0.88,
        s=36,
        edgecolors="none",
    )

ax.set_title("Kolo Music Latent Space: 2D t-SNE Projection", color="#f4f4f1", fontsize=17, fontweight="bold", pad=15)
ax.tick_params(colors="#858581")
ax.legend(
    facecolor="#121212",
    edgecolor="#262626",
    labelcolor="#f4f4f1",
    fontsize=9.5,
    loc="lower left",
    framealpha=0.95,
)
plt.tight_layout()
fig.savefig(RES_DIR / "vibe_clusters_tsne.png", dpi=200, facecolor=fig.get_facecolor(), bbox_inches="tight")
plt.close(fig)

# 2D UMAP
fig, ax = plt.subplots(figsize=(15, 11), facecolor="#080808")
ax.set_facecolor("#080808")
ax.grid(True, color="#1c1c1c", linestyle="--", linewidth=0.5, alpha=0.6)

for k in range(K):
    idx_k = (user_cluster_labels == k)
    ax.scatter(
        coords_2d_umap[idx_k, 0],
        coords_2d_umap[idx_k, 1],
        c=CLUSTER_PALETTE[k],
        label=f"{CLUSTER_NAMES[k]} ({np.sum(idx_k)})",
        alpha=0.88,
        s=36,
        edgecolors="none",
    )

ax.set_title("Kolo Music Latent Space: 2D UMAP Projection", color="#f4f4f1", fontsize=17, fontweight="bold", pad=15)
ax.tick_params(colors="#858581")
ax.legend(
    facecolor="#121212",
    edgecolor="#262626",
    labelcolor="#f4f4f1",
    fontsize=9.5,
    loc="lower left",
    framealpha=0.95,
)
plt.tight_layout()
fig.savefig(RES_DIR / "vibe_clusters_umap.png", dpi=200, facecolor=fig.get_facecolor(), bbox_inches="tight")
plt.close(fig)

# Heatmap
centers = km.cluster_centers_
centers_norm = centers / np.linalg.norm(centers, axis=1, keepdims=True)
sim_matrix = np.dot(centers_norm, centers_norm.T)

kolo_cmap = mcolors.LinearSegmentedColormap.from_list(
    "kolo_monochrome_accent", ["#080808", "#1a2c2a", "#0d8275", "#ffffff"]
)

fig, ax = plt.subplots(figsize=(10, 8), facecolor="#080808")
ax.set_facecolor("#080808")
im = ax.imshow(sim_matrix, cmap=kolo_cmap, vmin=-0.2, vmax=1.0)
cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
cbar.ax.yaxis.set_tick_params(color="#858581")
plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color="#858581")

labels_short = [CLUSTER_NAMES[k].split(" (")[0] for k in range(K)]
ax.set_xticks(range(K))
ax.set_yticks(range(K))
ax.set_xticklabels(labels_short, rotation=35, ha="right", color="#f4f4f1", fontsize=9)
ax.set_yticklabels(labels_short, color="#f4f4f1", fontsize=9)

for i in range(K):
    for j in range(K):
        text_color = "#ffffff" if sim_matrix[i, j] < 0.65 else "#080808"
        ax.text(
            j, i, f"{sim_matrix[i, j]:.2f}",
            ha="center", va="center", color=text_color, fontweight="bold", fontsize=9
        )

ax.set_title("Cross-Genre Cosine Similarity Heatmap", color="#f4f4f1", fontsize=14, fontweight="bold", pad=15)
plt.tight_layout()
fig.savefig(RES_DIR / "vibe_relationships_heatmap.png", dpi=200, facecolor=fig.get_facecolor(), bbox_inches="tight")
plt.close(fig)

# Interactive HTML
points_data = []
for i in range(len(ids_user)):
    c = int(user_cluster_labels[i])
    pts_tsne_3d = [round(float(coords_3d_tsne[i, d]), 3) for d in range(3)]
    pts_umap_3d = [round(float(coords_3d_umap[i, d]), 3) for d in range(3)]
    pts_tsne_2d = [round(float(coords_2d_tsne[i, d]), 3) for d in range(2)]
    pts_umap_2d = [round(float(coords_2d_umap[i, d]), 3) for d in range(2)]
    points_data.append({
        "id": i,
        "file": str(ids_user[i]),
        "title": clean_title(ids_user[i]),
        "cluster": c,
        "cluster_name": CLUSTER_NAMES[c],
        "color": CLUSTER_PALETTE[c],
        "duration": round(float(durs_user[i]), 1),
        "tsne_3d": pts_tsne_3d,
        "umap_3d": pts_umap_3d,
        "tsne_2d": pts_tsne_2d,
        "umap_2d": pts_umap_2d,
    })

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kolo: 3D Latent Space Explorer</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 0;
      background: #080808;
      color: #f4f4f1;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
    }}
    #header {{
      height: 64px;
      padding: 0 24px;
      background: rgba(10, 10, 10, 0.96);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.085);
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
      position: relative;
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .title {{
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0;
      color: #f4f4f1;
    }}
    .controls {{
      display: flex;
      align-items: center;
      gap: 16px;
    }}
    .search-box {{
      position: relative;
    }}
    .search-box input {{
      background: #141414;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #f4f4f1;
      padding: 7px 14px 7px 32px;
      border-radius: 8px;
      font-size: 13px;
      width: 230px;
      outline: none;
      transition: all 0.2s;
    }}
    .search-box input:focus {{
      border-color: #0d8275;
      box-shadow: 0 0 0 2px rgba(13, 130, 117, 0.25);
      width: 270px;
    }}
    .search-box svg {{
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 14px;
      height: 14px;
      fill: #858581;
    }}
    .mode-pills {{
      display: flex;
      background: #141414;
      padding: 3px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.085);
    }}
    .mode-btn {{
      background: transparent;
      border: none;
      color: #858581;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }}
    .mode-btn.active {{
      background: #0d8275;
      color: #061113;
      font-weight: 700;
    }}
    #plot-container {{
      width: 100vw;
      height: calc(100vh - 64px);
    }}
    #active-view-label {{
      font-size: 12px;
      color: #858581;
      margin-left: 8px;
      font-weight: 500;
    }}
  </style>
</head>
<body>
  <div id="header">
    <div class="brand">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
           stroke="#0d8275" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <h1 class="title">Taste Universe</h1>
      <span id="active-view-label">3D t-SNE</span>
    </div>
    <div class="controls">
      <div class="search-box">
        <svg viewBox="0 0 24 24">
          <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
        <input type="text" id="search-input" placeholder="Search track or artist...">
      </div>
      <div class="mode-pills">
        <button class="mode-btn active" onclick="setMode('tsne_3d')">3D t-SNE</button>
        <button class="mode-btn" onclick="setMode('umap_3d')">3D UMAP</button>
      </div>
    </div>
  </div>

  <div id="plot-container"></div>

  <script src="https://cdn.plot.ly/plotly-2.30.0.min.js"></script>
  <script>
    const allTracks = {json.dumps(points_data)};
    const clusterNames = {json.dumps(CLUSTER_NAMES)};
    const clusterPalette = {json.dumps(CLUSTER_PALETTE)};

    let currentMode = 'tsne_3d';
    let searchQuery = '';

    function isMatch(p) {{
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return p.title.toLowerCase().includes(q) || p.file.toLowerCase().includes(q);
    }}

    function getTraceForCluster(k, mode, search) {{
      const pts = allTracks.filter(d => d.cluster === k);
      const is3D = mode.endsWith('_3d');

      const x = pts.map(p => p[mode][0]);
      const y = pts.map(p => p[mode][1]);
      const z = is3D ? pts.map(p => p[mode][2]) : null;

      const colors = pts.map(p => {{
        if (!search) return clusterPalette[k];
        return isMatch(p) ? '#0d8275' : 'rgba(255, 255, 255, 0.12)';
      }});

      const sizes = pts.map(p => {{
        if (!search) return 4;
        return isMatch(p) ? 9 : 2.5;
      }});

      const trace = {{
        name: clusterNames[k] + ` (${{pts.length}})`,
        type: is3D ? 'scatter3d' : 'scatter',
        mode: 'markers',
        text: pts.map(p =>
          `<b>${{p.file}}</b><br>Genre: ${{p.cluster_name}}<br>` +
          `Duration: ${{Math.floor(p.duration/60)}}m ${{Math.round(p.duration%60)}}s`
        ),
        hoverinfo: 'text',
        marker: {{
          size: sizes,
          color: colors,
          opacity: 0.88,
          line: {{ width: 0 }}
        }}
      }};

      if (is3D) {{
        trace.x = x; trace.y = y; trace.z = z;
      }} else {{
        trace.x = x; trace.y = y;
      }}
      return trace;
    }}

    function renderPlot() {{
      const is3D = currentMode.endsWith('_3d');
      const traces = [];
      for (let k = 0; k < {K}; k++) {{
        traces.push(getTraceForCluster(k, currentMode, searchQuery));
      }}

      const layout = {{
        margin: {{ l: 0, r: 0, b: 0, t: 0 }},
        paper_bgcolor: '#080808',
        plot_bgcolor: '#080808',
        showlegend: true,
        legend: {{
          x: 0.02,
          y: 0.98,
          font: {{ color: '#f4f4f1', size: 11 }},
          bgcolor: 'rgba(18, 18, 18, 0.9)',
          bordercolor: 'rgba(255, 255, 255, 0.1)',
          borderwidth: 1
        }},
        hoverlabel: {{
          bgcolor: '#121212',
          bordercolor: '#0d8275',
          font: {{ color: '#f4f4f1', size: 12 }}
        }}
      }};

      if (is3D) {{
        layout.scene = {{
          xaxis: {{
            showgrid: true,
            gridcolor: 'rgba(255, 255, 255, 0.08)',
            zerolinecolor: 'rgba(255, 255, 255, 0.15)',
            tickfont: {{ color: '#858581' }}
          }},
          yaxis: {{
            showgrid: true,
            gridcolor: 'rgba(255, 255, 255, 0.08)',
            zerolinecolor: 'rgba(255, 255, 255, 0.15)',
            tickfont: {{ color: '#858581' }}
          }},
          zaxis: {{
            showgrid: true,
            gridcolor: 'rgba(255, 255, 255, 0.08)',
            zerolinecolor: 'rgba(255, 255, 255, 0.15)',
            tickfont: {{ color: '#858581' }}
          }},
          bgcolor: '#080808'
        }};
      }} else {{
        const axisStyle = {{
          showgrid: true,
          gridcolor: 'rgba(255, 255, 255, 0.08)',
          zerolinecolor: 'rgba(255, 255, 255, 0.15)',
          tickfont: {{ color: '#858581' }}
        }};
        layout.xaxis = axisStyle;
        layout.yaxis = axisStyle;
      }}

      Plotly.react('plot-container', traces, layout, {{ responsive: true, displayModeBar: true }});
    }}

    function setMode(mode) {{
      currentMode = mode;
      document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.mode-btn'))
        .find(b => b.getAttribute('onclick').includes(mode));
      if (activeBtn) activeBtn.classList.add('active');

      const labels = {{
        'tsne_3d': '3D t-SNE',
        'umap_3d': '3D UMAP',
        'tsne_2d': '2D t-SNE',
        'umap_2d': '2D UMAP'
      }};
      document.getElementById('active-view-label').innerText = labels[mode];
      renderPlot();
    }}

    document.getElementById('search-input').addEventListener('input', (e) => {{
      searchQuery = e.target.value.trim();
      renderPlot();
    }});

    // Initial render
    renderPlot();
  </script>
</body>
</html>
"""

# Keep one analysis copy and one deployable app copy.
with open(RES_DIR / "kolo_interactive.html", "w", encoding="utf-8") as f:
    f.write(html_content)

pub_path = APP_DIR / "public" / "cluster_visualization.html"
pub_path.parent.mkdir(parents=True, exist_ok=True)
with open(pub_path, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"[+] Exported interactive explorer to {pub_path}")
print("[+] Cluster regeneration and visualization complete")
