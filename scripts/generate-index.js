const fs = require('fs');
const path = require('path');

// Configuration
const ROOT_DIR = path.join(__dirname, '..');
const SIMULATIONS_JSON = path.join(ROOT_DIR, 'simulations.json');
const INDEX_HTML = path.join(ROOT_DIR, 'index.html');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');

// Directories to scan for simulations
const SCAN_DIRS = [
  { path: '.', category: 'other' },
  { path: 'Light', category: 'light' },
  { path: 'Sound', category: 'sound' },
  { path: 'Light/table', category: 'light' },
  { path: 'two-microphones', category: 'sound' }
];

// Files to exclude from scanning
const EXCLUDE_FILES = ['index.html'];
const EXCLUDE_PATTERNS = [/^test\s/i]; // Files starting with "test "

/**
 * Scan directories for HTML files
 */
function scanForHtmlFiles() {
  const found = [];

  for (const dir of SCAN_DIRS) {
    const fullPath = path.join(ROOT_DIR, dir.path);
    if (!fs.existsSync(fullPath)) continue;

    const files = fs.readdirSync(fullPath);
    for (const file of files) {
      if (!file.endsWith('.html')) continue;

      // For two-microphones, we want the index.html (it's a built app)
      if (dir.path === 'two-microphones' && file === 'index.html') {
        found.push({
          path: `${dir.path}/${file}`,
          category: dir.category
        });
        continue;
      }

      // Skip index.html in other directories
      if (file === 'index.html') continue;

      const relativePath = dir.path === '.' ? file : `${dir.path}/${file}`;
      found.push({
        path: relativePath,
        category: dir.category
      });
    }
  }

  return found;
}

/**
 * Extract title from HTML file
 */
function extractTitle(filePath) {
  try {
    const fullPath = path.join(ROOT_DIR, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const match = content.match(/<title>([^<]+)<\/title>/i);
    if (match) {
      return match[1].trim();
    }
  } catch (e) {
    // Ignore errors
  }

  // Fallback: convert filename to title
  const basename = path.basename(filePath, '.html');
  return basename
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Detect category from file path
 */
function detectCategory(filePath) {
  if (filePath.startsWith('Light/')) return 'light';
  if (filePath.startsWith('Sound/')) return 'sound';
  if (filePath.startsWith('two-microphones/')) return 'sound';
  if (filePath.includes('random-walk')) return 'random';
  return 'other';
}

/**
 * Get default emoji for category
 */
function getDefaultEmoji(category) {
  const emojis = {
    light: '💡',
    sound: '🔊',
    random: '🎲',
    other: '🔬'
  };
  return emojis[category] || '📄';
}

/**
 * Take screenshots of simulations using Playwright
 */
async function takeScreenshots(simulations, forceAll = false) {
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // Filter simulations that need screenshots
  const needsScreenshot = simulations.filter(sim => {
    const screenshotPath = getScreenshotPath(sim.path);
    return forceAll || !fs.existsSync(screenshotPath);
  });

  if (needsScreenshot.length === 0) {
    console.log('All screenshots are up to date.');
    return;
  }

  console.log(`Taking ${needsScreenshot.length} screenshot(s)...`);

  // Dynamic import for playwright
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 }
  });

  for (const sim of needsScreenshot) {
    const page = await context.newPage();
    const filePath = path.join(ROOT_DIR, sim.path);
    const screenshotPath = getScreenshotPath(sim.path);

    // Ensure screenshot subdirectory exists
    const screenshotDir = path.dirname(screenshotPath);
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    try {
      console.log(`  Capturing: ${sim.path}`);
      await page.goto(`file://${filePath}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait a bit for any animations to settle
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: screenshotPath,
        type: 'png'
      });
    } catch (e) {
      console.error(`  Error capturing ${sim.path}: ${e.message}`);
    }

    await page.close();
  }

  await browser.close();
  console.log('Screenshots complete.');
}

/**
 * Get screenshot path for a simulation
 */
function getScreenshotPath(simPath) {
  // Convert path to screenshot filename
  const safeName = simPath
    .replace(/\//g, '_')
    .replace(/\.html$/, '.png')
    .replace(/\s+/g, '_');
  return path.join(SCREENSHOTS_DIR, safeName);
}

/**
 * Check if screenshot exists for a simulation
 */
function hasScreenshot(simPath) {
  return fs.existsSync(getScreenshotPath(simPath));
}

/**
 * Get relative screenshot path for HTML
 */
function getRelativeScreenshotPath(simPath) {
  const safeName = simPath
    .replace(/\//g, '_')
    .replace(/\.html$/, '.png')
    .replace(/\s+/g, '_');
  return `screenshots/${safeName}`;
}

/**
 * Generate index.html from simulations data
 */
function generateIndexHtml(data) {
  const { categories, simulations } = data;

  // Group simulations by category
  const grouped = {};
  for (const cat of categories) {
    grouped[cat.id] = [];
  }

  for (const sim of simulations) {
    if (grouped[sim.category]) {
      grouped[sim.category].push(sim);
    }
  }

  // Generate HTML
  let categoriesHtml = '';

  for (const cat of categories) {
    const sims = grouped[cat.id];
    if (sims.length === 0) continue;

    let cardsHtml = '';
    for (const sim of sims) {
      const encodedPath = sim.path.split('/').map(encodeURIComponent).join('/');
      const screenshotPath = getRelativeScreenshotPath(sim.path);
      const hasScreenshotFile = hasScreenshot(sim.path);

      const previewHtml = hasScreenshotFile
        ? `<div class="card-preview"><img src="${screenshotPath}" alt="${sim.title}" loading="lazy"></div>`
        : `<div class="card-preview ${cat.cardStyle}">${sim.emoji}</div>`;

      cardsHtml += `
                <a href="${encodedPath}" class="simulation-card">
                    ${previewHtml}
                    <div class="card-content">
                        <h3 class="card-title">${sim.title}</h3>
                        <p class="card-description">${sim.description}</p>
                    </div>
                </a>
`;
    }

    categoriesHtml += `
        <!-- ${cat.title} -->
        <section class="category">
            <div class="category-header">
                <span class="category-icon">${cat.icon}</span>
                <h2 class="category-title">${cat.title}</h2>
            </div>
            <div class="simulations-grid">${cardsHtml}            </div>
        </section>
`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Middle School Physics Simulations</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 50px;
            color: white;
        }

        h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }

        .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
        }

        .category {
            margin-bottom: 40px;
        }

        .category-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid rgba(255,255,255,0.3);
        }

        .category-icon {
            font-size: 2rem;
        }

        .category-title {
            color: white;
            font-size: 1.5rem;
            font-weight: 600;
        }

        .simulations-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
        }

        .simulation-card {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            transition: transform 0.2s, box-shadow 0.2s;
            text-decoration: none;
            color: inherit;
            display: block;
        }

        .simulation-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        }

        .card-preview {
            height: 160px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 3rem;
            overflow: hidden;
        }

        .card-preview img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .card-preview.light { background: linear-gradient(135deg, #fff9c4 0%, #ffeb3b 100%); }
        .card-preview.sound { background: linear-gradient(135deg, #b3e5fc 0%, #03a9f4 100%); }
        .card-preview.random { background: linear-gradient(135deg, #c8e6c9 0%, #4caf50 100%); }
        .card-preview.other { background: linear-gradient(135deg, #e1bee7 0%, #9c27b0 100%); }

        .card-content {
            padding: 15px;
        }

        .card-title {
            font-size: 1rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 8px;
        }

        .card-description {
            font-size: 0.85rem;
            color: #666;
            line-height: 1.4;
        }

        .card-path {
            font-size: 0.75rem;
            color: #999;
            margin-top: 8px;
            font-family: monospace;
        }

        footer {
            text-align: center;
            margin-top: 50px;
            color: rgba(255,255,255,0.7);
            font-size: 0.9rem;
        }

        .auto-generated {
            margin-top: 10px;
            font-size: 0.75rem;
            opacity: 0.6;
        }

        @media (max-width: 600px) {
            h1 { font-size: 1.8rem; }
            .category-title { font-size: 1.2rem; }
            body { padding: 20px 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🔬 Middle School Physics Simulations</h1>
            <p class="subtitle">Interactive physics demonstrations for Course 539</p>
        </header>
${categoriesHtml}
        <footer>
            <p>AoPS Curriculum &bull; Middle School Physics Course 539</p>
            <p class="auto-generated">Auto-generated on ${new Date().toISOString().split('T')[0]}</p>
        </footer>
    </div>
</body>
</html>
`;

  return html;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const screenshotsOnly = args.includes('--screenshots-only');
  const skipScreenshots = args.includes('--no-screenshots');
  const forceScreenshots = args.includes('--force-screenshots');

  console.log('Scanning for HTML files...');
  const foundFiles = scanForHtmlFiles();
  console.log(`Found ${foundFiles.length} HTML files.`);

  // Load existing simulations.json
  let data = { categories: [], simulations: [] };
  if (fs.existsSync(SIMULATIONS_JSON)) {
    data = JSON.parse(fs.readFileSync(SIMULATIONS_JSON, 'utf8'));
  }

  // Ensure default categories exist
  if (data.categories.length === 0) {
    data.categories = [
      { id: 'light', title: 'Light & Optics', icon: '💡', cardStyle: 'light' },
      { id: 'sound', title: 'Sound & Waves', icon: '🔊', cardStyle: 'sound' },
      { id: 'random', title: 'Random Walk & Probability', icon: '🎲', cardStyle: 'random' },
      { id: 'other', title: 'Other Simulations', icon: '🔬', cardStyle: 'other' }
    ];
  }

  // Create a map of existing simulations
  const existingPaths = new Set(data.simulations.map(s => s.path));

  // Find new simulations
  const newSims = [];
  for (const file of foundFiles) {
    if (!existingPaths.has(file.path)) {
      const title = extractTitle(file.path);
      const category = detectCategory(file.path);
      const newSim = {
        path: file.path,
        title: title,
        description: `New simulation - description pending.`,
        emoji: getDefaultEmoji(category),
        category: category
      };
      newSims.push(newSim);
      data.simulations.push(newSim);
      console.log(`  NEW: ${file.path} -> "${title}" (${category})`);
    }
  }

  // Find removed simulations
  const foundPaths = new Set(foundFiles.map(f => f.path));
  const removedSims = data.simulations.filter(s => !foundPaths.has(s.path));
  if (removedSims.length > 0) {
    console.log(`\nRemoving ${removedSims.length} missing simulation(s):`);
    for (const sim of removedSims) {
      console.log(`  REMOVED: ${sim.path}`);
    }
    data.simulations = data.simulations.filter(s => foundPaths.has(s.path));
  }

  // Save updated simulations.json if there were changes
  if (newSims.length > 0 || removedSims.length > 0) {
    fs.writeFileSync(SIMULATIONS_JSON, JSON.stringify(data, null, 2));
    console.log('\nUpdated simulations.json');
  }

  // Take screenshots
  if (!skipScreenshots) {
    await takeScreenshots(data.simulations, forceScreenshots);
  }

  // Generate index.html
  if (!screenshotsOnly) {
    console.log('\nGenerating index.html...');
    const html = generateIndexHtml(data);
    fs.writeFileSync(INDEX_HTML, html);
    console.log('Done! index.html has been updated.');
  }
}

main().catch(console.error);
