# 🚀 Quick Start - Activate New Architecture

## ⚡ 5-Minute Integration

### Step 1: Update timeline.js (Line 1)

```bash
# Open frontend/src/timeline.js
# Change line 1 from:
import { STATE, els } from './state.js';

# To:
import { STATE, els } from './stateBridge.js';
```

### Step 2: Update audio.js (Line 1)

```bash
# Open frontend/src/audio.js
# Change line 1 from:
import { STATE, els } from './state.js';

# To:
import { STATE, els } from './stateBridge.js';
```

### Step 3: Update main-new.js (After line 29)

```bash
# Open frontend/src/main-new.js
# Add after line 29 (after getting service references):

// Set up state bridge for legacy code
import { setStateManager } from './stateBridge.js';
import { els as bridgeEls } from './stateBridge.js';

setStateManager(stateManager);

// Copy elements to bridge
Object.assign(bridgeEls, els);
```

### Step 4: Update index.html (Line 157)

```bash
# Open frontend/index.html
# Change line 157 from:
<script type="module" src="./src/main.js"></script>

# To:
<script type="module" src="./src/main-new.js"></script>
```

### Step 5: Test!

```bash
# Run the app
wails dev

# Run tests
cd frontend && npm test
```

## ✅ Expected Results

- App loads without errors
- Timeline renders correctly
- All features work (save, load, undo, etc.)
- 65 tests pass

## 🐛 Troubleshooting

**Issue:** Console error about undefined state
**Fix:** Make sure Step 3 is done correctly

**Issue:** Tests fail
**Fix:** Run `npm install` in frontend folder

**Issue:** App doesn't load
**Fix:** Check browser console for error details

## 📚 More Info

- Full guide: [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md)
- Summary: [REFACTORING_COMPLETE.md](REFACTORING_COMPLETE.md)

---

**Ready?** Start with Step 1!
