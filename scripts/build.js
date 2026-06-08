const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'public');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Verify required files exist
const required = ['index.html', 'app.js', 'styles.css'];
for (const file of required) {
  const filePath = path.join(outputDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file}`);
  } else {
    console.error(`✗ Missing: ${file}`);
    process.exit(1);
  }
}

console.log('Build complete. All files ready in public/');
