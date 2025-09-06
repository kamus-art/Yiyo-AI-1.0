/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  Modality,
} from '@google/genai';

const MAX_RETRIES = 10;

// --- STATE MANAGEMENT ---
let currentMode = 'generate';
let generateMode = 'image';
let editMode = 'ia';
let creativityLevel = 0.5;
let apiKey = null;

let base64data1 = '';
let mimeType1 = '';
let prompt = '';
let currentVideoBlobUrl = null;
let hasMask = false;
let uploadedFileName = '';
let promptOnlyImageCounter = 1;
let promptOnlyVideoCounter = 1;
let refImageEditCounter = 1;
let refImageVideoCounter = 1;
let currentVideoDownloadName = '';


async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob) {
  return new Promise(async (resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      resolve(url.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Resizes an image to fit a target aspect ratio by adding black bars (letterboxing/pillarboxing).
 * @param base64 The base64 string of the source image.
 * @param mimeType The MIME type of the source image.
 * @param targetAspectRatioString The target aspect ratio ('16:9' or '9:16').
 * @returns A promise that resolves to an object with the new base64 and mimeType.
 */
async function resizeImageToFitAspectRatio(
    base64,
    mimeType,
    targetAspectRatioString
) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const [w, h] = targetAspectRatioString.split(':').map(Number);
            const targetAspectRatio = w / h;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not get canvas context'));

            let canvasWidth = img.naturalWidth;
            let canvasHeight = img.naturalWidth / targetAspectRatio;

            if (canvasHeight < img.naturalHeight) {
                canvasHeight = img.naturalHeight;
                canvasWidth = img.naturalHeight * targetAspectRatio;
            }

            canvas.width = Math.round(canvasWidth);
            canvas.height = Math.round(canvasHeight);

            // Fill with black background
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Calculate scaled image dimensions to fit within canvas
            const imgAspectRatio = img.naturalWidth / img.naturalHeight;
            let drawWidth = canvas.width;
            let drawHeight = canvas.width / imgAspectRatio;
            if (drawHeight > canvas.height) {
                drawHeight = canvas.height;
                drawWidth = canvas.height * imgAspectRatio;
            }
            
            // Center the image
            const x = (canvas.width - drawWidth) / 2;
            const y = (canvas.height - drawHeight) / 2;
            
            ctx.drawImage(img, x, y, drawWidth, drawHeight);

            const outputMimeType = 'image/png';
            const newBase64 = canvas.toDataURL(outputMimeType).split(',')[1];
            resolve({ base64: newBase64, mimeType: outputMimeType });
        };
        img.onerror = (err) => reject(err);
        img.src = `data:${mimeType};base64,${base64}`;
    });
}

/**
 * Resizes an image from a data URL to specific dimensions.
 * @param imageUrl The data URL of the source image.
 * @param targetWidth The target width.
 * @param targetHeight The target height.
 * @returns A promise that resolves to the data URL of the resized image.
 */
async function resizeImageToDimensions(imageUrl, targetWidth, targetHeight) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not get canvas context'));
            
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (err) => reject(err);
        img.src = imageUrl;
    });
}


// Main UI Elements
const mainApp = document.querySelector('#main-app');
const downloadButton = document.querySelector('#download-button');
const upload1 = document.querySelector('#file-input-1');
const promptEl = document.querySelector('#prompt-input');
const enhancePromptButton = document.querySelector('#enhance-prompt-button');
const statusContainer = document.querySelector('#status-container');
const videoStatusContainer = document.querySelector('#video-status-container');
const videoContainer = document.querySelector('.video-container');
const videoEl = document.querySelector('#video');
const editorWrapper = document.querySelector('#editor-wrapper');
const imgPreview1 = document.querySelector('#img-1');
const fileNameEl1 = document.querySelector('#file-name-1');
const editedImageContainer = document.querySelector('#edited-image-container');
const editedImageGrid = document.querySelector('#edited-image-grid');
const lightbox = document.querySelector('#lightbox');
const lightboxImg = document.querySelector('#lightbox-img');
const lightboxClose = document.querySelector('.lightbox-close');
const safetyLevelSelect = document.querySelector('#safety-level-select');
const safetyWarning = document.querySelector('#safety-warning');
const themeToggle = document.querySelector('#theme-toggle');

// New UI Elements for Tabs & Controls
const mainTabs = document.querySelectorAll('.main-tabs .tab-button');
const editTabButton = document.querySelector('#edit-tab-button');
const generateControls = document.querySelector('#generate-controls');
const editControls = document.querySelector('#edit-controls');

const generateSubTabs = document.querySelectorAll('#generate-controls .sub-tab-button');
const generateImageControls = document.querySelector('#generate-image-controls');
const generateVideoControls = document.querySelector('#generate-video-controls');

const editSubTabs = document.querySelectorAll('#edit-controls .sub-tab-button');
const editInpaintControls = document.querySelector('#edit-inpaint-controls');
const upscaleControls = document.querySelector('#upscale-controls');

const generateImageButton = document.querySelector('#generate-image-button');
const generateVideoButton = document.querySelector('#generate-video-button');
const editImageButton = document.querySelector('#edit-image-button');
const upscaleImageButton = document.querySelector('#upscale-image-button');

// Sliders
const imageCountSlider = document.querySelector('#image-count-slider');
const imageCountValue = document.querySelector('#image-count-value');
const upscaleSlider = document.querySelector('#upscale-slider');
const upscaleValue = document.querySelector('#upscale-value');
const creativitySlider = document.querySelector('#creativity-slider');
const creativityValue = document.querySelector('#creativity-value');

// Inpaint Controls
const inpaintModeDescription = document.querySelector('#inpaint-mode-description');
const inpaintOptions = document.querySelector('#inpaint-options');
const openEditorButton = document.querySelector('#open-editor-button');


// Mask Editor Modal Elements
const editorModal = document.querySelector('#editor-modal');
const editorViewport = document.querySelector('#editor-viewport');
const editorCanvasContainer = document.querySelector('#editor-canvas-container');
const editorImage = document.querySelector('#editor-image');
const editorMaskCanvas = document.querySelector('#editor-mask-canvas');
const editorCloseButton = document.querySelector('#editor-close-button');
const editorSaveButton = document.querySelector('#editor-save-button');
const editorClearButton = document.querySelector('#editor-clear-button');
const editorBrushSizeSlider = document.querySelector('#editor-brush-size');
const editorBrushSizeValue = document.querySelector('#editor-brush-size-value');
const editorBrushToggle = document.querySelector('#editor-brush-toggle');
const editorBrushCursor = document.querySelector('#editor-brush-cursor');
const zoomInButton = document.querySelector('#zoom-in-button');
const zoomOutButton = document.querySelector('#zoom-out-button');
const zoomResetButton = document.querySelector('#zoom-reset-button');
const zoomIndicator = document.querySelector('#editor-zoom-indicator');

// API Key Modal Elements
const apiKeyButton = document.querySelector('#api-key-button');
const apiKeyModal = document.querySelector('#api-key-modal');
const apiKeyCloseButton = document.querySelector('#api-key-close-button');
const apiKeyInput = document.querySelector('#api-key-input');
const apiKeyAcceptButton = document.querySelector('#api-key-accept-button');

// This canvas is hidden in the main UI and holds the final mask data from the editor
const maskCanvas = document.querySelector('#mask-canvas');
let maskCtx = maskCanvas.getContext('2d');
const previewMaskCanvas = document.querySelector('#preview-mask-canvas');
const previewMaskCtx = previewMaskCanvas?.getContext('2d');

// --- Fullscreen Editor State and Logic ---
const editorMaskCtx = editorMaskCanvas.getContext('2d');
let isEditorDrawing = false;
let isPanning = false;
let isBrushActive = true;
let isSpacebarDown = false;
let lastPanPoint = { x: 0, y: 0 };
let lastEditorPoint = null;
let viewState = {
    scale: 1,
    offsetX: 0,
    offsetY: 0
};
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

// --- API Key Management ---
function showApiKeyModal() {
    if (apiKey) {
        apiKeyInput.value = apiKey;
    }
    apiKeyModal.style.display = 'flex';
}

function hideApiKeyModal() {
    apiKeyModal.style.display = 'none';
}

function saveAndSetApiKey(key) {
    if (!key || key.trim() === '') {
        alert('Por favor, ingresa una API Key válida.');
        return;
    }
    apiKey = key;
    localStorage.setItem('YIYO_AI_API_KEY', apiKey);
    hideApiKeyModal();
}

function updateZoomIndicator() {
    zoomIndicator.textContent = `${Math.round(viewState.scale * 100)}%`;
}

function updateTransform() {
    editorCanvasContainer.style.transform = `translate(${viewState.offsetX}px, ${viewState.offsetY}px) scale(${viewState.scale})`;
    updateZoomIndicator();
}

function getCanvasCoords(event) {
    const viewportRect = editorViewport.getBoundingClientRect();
    // Mouse position relative to the viewport element
    const mouseX = event.clientX - viewportRect.left;
    const mouseY = event.clientY - viewportRect.top;
    
    // Translate mouse position into the coordinate system of the transformed canvas container
    const canvasX = (mouseX - viewState.offsetX) / viewState.scale;
    const canvasY = (mouseY - viewState.offsetY) / viewState.scale;

    return { x: canvasX, y: canvasY };
}


function updateBrushCursor(e) {
    if (!isBrushActive || isPanning) {
        editorBrushCursor.style.display = 'none';
        return;
    }
    editorBrushCursor.style.display = 'block';
    const brushSize = parseInt(editorBrushSizeSlider.value, 10);
    const rect = editorViewport.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    editorBrushCursor.style.width = `${brushSize * viewState.scale}px`;
    editorBrushCursor.style.height = `${brushSize * viewState.scale}px`;
    // The CSS transform: translate(-50%, -50%) centers the cursor, so we just set the top/left to the mouse position.
    editorBrushCursor.style.left = `${x}px`;
    editorBrushCursor.style.top = `${y}px`;
}

function setBrushMode(isActive) {
    isBrushActive = isActive;
    editorBrushToggle.classList.toggle('active', isActive);
    if (isActive) {
        editorViewport.style.cursor = 'none';
    } else {
        editorViewport.style.cursor = 'grab';
        editorBrushCursor.style.display = 'none';
    }
}

function resetEditorView() {
    if (!base64data1) return;
    const { naturalWidth, naturalHeight } = imgPreview1;
    const viewportRect = editorViewport.getBoundingClientRect();
    
    const initialScale = Math.min(
        viewportRect.width / naturalWidth,
        viewportRect.height / naturalHeight
    ) * 0.95; // Fit with a little padding

    viewState.scale = initialScale;
    viewState.offsetX = (viewportRect.width - naturalWidth * initialScale) / 2;
    viewState.offsetY = (viewportRect.height - naturalHeight * initialScale) / 2;
    updateTransform();
}

function openEditor() {
    if (!editorMaskCtx || !base64data1) return;
    
    const { naturalWidth, naturalHeight } = imgPreview1;
    
    editorCanvasContainer.style.width = `${naturalWidth}px`;
    editorCanvasContainer.style.height = `${naturalHeight}px`;

    editorMaskCanvas.width = naturalWidth;
    editorMaskCanvas.height = naturalHeight;

    editorImage.src = imgPreview1.src;

    editorMaskCtx.clearRect(0, 0, naturalWidth, naturalHeight);
    if (hasMask) {
        editorMaskCtx.drawImage(maskCanvas, 0, 0);
    }
    
    editorMaskCtx.strokeStyle = 'rgb(239, 68, 68)';
    editorMaskCtx.lineCap = 'round';
    editorMaskCtx.lineJoin = 'round';
    editorMaskCtx.lineWidth = parseInt(editorBrushSizeSlider.value, 10);
    
    editorModal.classList.add('is-visible');
    document.body.style.overflow = 'hidden';

    resetEditorView();
    setBrushMode(true);
}

function closeEditor() {
    editorModal.classList.remove('is-visible');
    document.body.style.overflow = '';
}

function drawPreviewMask() {
    if (!previewMaskCtx) return;

    if (!hasMask) {
        previewMaskCanvas.style.display = 'none';
        if (previewMaskCanvas.width > 0 && previewMaskCanvas.height > 0) {
          previewMaskCtx.clearRect(0, 0, previewMaskCanvas.width, previewMaskCanvas.height);
        }
        return;
    }
    
    const renderedWidth = imgPreview1.width;
    const renderedHeight = imgPreview1.height;
    
    previewMaskCanvas.width = renderedWidth;
    previewMaskCanvas.height = renderedHeight;
    previewMaskCanvas.style.display = 'block';

    previewMaskCtx.drawImage(maskCanvas, 0, 0, renderedWidth, renderedHeight);

    previewMaskCtx.globalCompositeOperation = 'source-in';
    previewMaskCtx.fillStyle = 'rgba(239, 68, 68, 0.6)';
    previewMaskCtx.fillRect(0, 0, renderedWidth, renderedHeight);
    
    previewMaskCtx.globalCompositeOperation = 'source-over';
}


function saveMaskFromEditor() {
    if (!maskCtx || !editorMaskCtx) return;
    maskCanvas.width = editorMaskCanvas.width;
    maskCanvas.height = editorMaskCanvas.height;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(editorMaskCanvas, 0, 0);
    
    const imageData = editorMaskCtx.getImageData(0, 0, editorMaskCanvas.width, editorMaskCanvas.height);
    const hasDrawing = [...imageData.data].some(channel => channel !== 0);

    hasMask = hasDrawing;
    drawPreviewMask();
    updateUI();
    closeEditor();
}

function zoomAtPoint(direction, pointX, pointY) {
    const oldScale = viewState.scale;
    
    let newScale = oldScale + direction * 0.1;
    newScale = Math.round(newScale * 10) / 10; // Round to one decimal place
    newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
    
    if (newScale === oldScale) return;

    viewState.offsetX = pointX - (pointX - viewState.offsetX) * (newScale / oldScale);
    viewState.offsetY = pointY - (pointY - viewState.offsetY) * (newScale / oldScale);
    viewState.scale = newScale;

    updateTransform();
}

function handleZoom(e) {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    const rect = editorViewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    zoomAtPoint(direction, mouseX, mouseY);
}

function startPan(e) {
    if (e.button !== 0) return;
    isPanning = true;
    lastPanPoint = { x: e.clientX, y: e.clientY };
    editorViewport.style.cursor = 'grabbing';
}

function handlePan(e) {
    if (!isPanning) return;
    const dx = e.clientX - lastPanPoint.x;
    const dy = e.clientY - lastPanPoint.y;
    viewState.offsetX += dx;
    viewState.offsetY += dy;
    lastPanPoint = { x: e.clientX, y: e.clientY };
    updateTransform();
}

function stopPan() {
    if (!isPanning) return;
    isPanning = false;
    setBrushMode(isBrushActive); // Re-apply correct cursor
}

function startEditorDrawing(e) {
    if (e.button !== 0 || !editorMaskCtx) return;
    isEditorDrawing = true;
    const { x, y } = getCanvasCoords(e);
    lastEditorPoint = { x, y };
    
    // Draw a single dot on click for better feedback
    editorMaskCtx.beginPath();
    editorMaskCtx.fillStyle = editorMaskCtx.strokeStyle;
    editorMaskCtx.arc(x, y, editorMaskCtx.lineWidth / 2, 0, Math.PI * 2);
    editorMaskCtx.fill();
}

function handleEditorDraw(e) {
    if (!isEditorDrawing || !editorMaskCtx) return;
    const { x, y } = getCanvasCoords(e);

    if (lastEditorPoint) {
      editorMaskCtx.beginPath();
      editorMaskCtx.moveTo(lastEditorPoint.x, lastEditorPoint.y);
      editorMaskCtx.lineTo(x, y);
      editorMaskCtx.stroke();
    }
    
    lastEditorPoint = { x, y };
}

function stopEditorDrawing() {
    isEditorDrawing = false;
    lastEditorPoint = null;
}

function handleViewportPointerDown(e) {
    if (isBrushActive && !isSpacebarDown) {
        startEditorDrawing(e);
    } else {
        startPan(e);
    }
}

function handleViewportPointerMove(e) {
    updateBrushCursor(e);
    if (isPanning) {
        handlePan(e);
    } else if (isEditorDrawing) {
        handleEditorDraw(e);
    }
}

function handleViewportPointerUp(e) {
    if (isPanning) stopPan();
    if (isEditorDrawing) stopEditorDrawing();
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isSpacebarDown && editorModal.classList.contains('is-visible')) {
        e.preventDefault();
        isSpacebarDown = true;
        setBrushMode(false);
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && editorModal.classList.contains('is-visible')) {
        isSpacebarDown = false;
        // Check if the toggle button is active before switching back to brush
        const isToggleActive = editorBrushToggle.classList.contains('active');
        setBrushMode(isToggleActive);
    }
});
// --- End of Editor Logic ---

function updateVideoContainerAspectRatio(aspectRatio) {
    let paddingTop = '56.25%'; // Default for 16:9
    let maxWidth = '100%';

    if (aspectRatio === '9:16') {
        paddingTop = '177.77%'; // 16 / 9 * 100
        maxWidth = '360px';
    }
    
    videoContainer.style.paddingTop = paddingTop;
    videoContainer.style.maxWidth = maxWidth;
}

function updateActionButtonsState() {
    const hasPrompt = promptEl.value.trim().length > 0;
    const hasImage = !!base64data1;

    // Generate Mode
    generateImageButton.disabled = !hasPrompt;
    generateVideoButton.disabled = !hasPrompt;

    // Edit Mode
    const isGenerativeEditReady = (editMode === 'ia' || (editMode === 'inpaint' && hasMask)) && hasPrompt;
    
    editImageButton.disabled = !(hasImage && isGenerativeEditReady);
    upscaleImageButton.disabled = !hasImage;
}

function updateUI() {
    // Main Tabs
    mainTabs.forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-mode') === currentMode);
    });
    generateControls.style.display = currentMode === 'generate' ? 'block' : 'none';
    editControls.style.display = currentMode === 'edit' ? 'block' : 'none';

    if (currentMode === 'generate') {
        // Generate Sub-Tabs
        generateSubTabs.forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-generate-mode') === generateMode);
        });
        generateImageControls.style.display = generateMode === 'image' ? 'block' : 'none';
        generateVideoControls.style.display = generateMode === 'video' ? 'block' : 'none';

        // Action Buttons for Generate
        generateImageButton.style.display = generateMode === 'image' ? 'block' : 'none';
        generateVideoButton.style.display = generateMode === 'video' ? 'block' : 'none';
        editImageButton.style.display = 'none';
        upscaleImageButton.style.display = 'none';

    } else if (currentMode === 'edit') {
        // Edit Sub-Tabs
        editSubTabs.forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-edit-mode') === editMode);
        });
        editInpaintControls.style.display = editMode === 'inpaint' ? 'block' : 'none';
        upscaleControls.style.display = editMode === 'upscale' ? 'block' : 'none';
        
        // Action Buttons for Edit
        generateImageButton.style.display = 'none';
        generateVideoButton.style.display = 'none';
        editImageButton.style.display = (editMode === 'ia' || editMode === 'inpaint') ? 'block' : 'none';
        upscaleImageButton.style.display = editMode === 'upscale' ? 'block' : 'none';

        // Inpaint specific UI
        if (editMode === 'inpaint') {
            inpaintOptions.style.display = 'block';
            inpaintModeDescription.textContent = 'Pinta una máscara sobre el área que quieres modificar y describe el cambio.';
            // Hide creativity slider for outpainting as it's less relevant
            const creativitySliderGroup = creativitySlider.closest('.form-group');
            if (creativitySliderGroup) {
                creativitySliderGroup.style.display = 'block';
            }
        }
    }
    
    const isGenerateVideoTab = currentMode === 'generate' && generateMode === 'video';

    if (isGenerateVideoTab && currentVideoBlobUrl) {
        videoContainer.style.display = 'block';
        downloadButton.style.display = 'inline-flex';
    } else {
        videoContainer.style.display = 'none';
        downloadButton.style.display = 'none';
    }

    updateActionButtonsState();
}

function createImageResultItem(imageUrl, altText, fileName) {
    const itemContainer = document.createElement('div');
    itemContainer.className = 'edited-image-item';

    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = altText;
    img.addEventListener('click', () => {
        lightboxImg.src = img.src;
        lightbox.classList.add('is-visible');
    });

    const downloadLink = document.createElement('a');
    downloadLink.href = imageUrl;
    downloadLink.download = fileName;
    downloadLink.className = 'button-download';
    downloadLink.innerHTML = `<svg xmlns="http="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Descargar`;

    itemContainer.appendChild(img);
    itemContainer.appendChild(downloadLink);
    return itemContainer;
}

function setLoadingState(isLoading) {
    const buttons = [
        generateImageButton,
        generateVideoButton,
        editImageButton,
        upscaleImageButton,
        enhancePromptButton,
        upload1
    ];
    if (isLoading) {
        buttons.forEach(btn => btn.disabled = true);
        generateImageButton.classList.add('loading');
        generateVideoButton.classList.add('loading');
        editImageButton.classList.add('loading');
        upscaleImageButton.classList.add('loading');
    } else {
        // Let updateActionButtonsState re-enable buttons based on the current context
        updateActionButtonsState(); 
        enhancePromptButton.disabled = false;
        upload1.disabled = false;
        generateImageButton.classList.remove('loading');
        generateVideoButton.classList.remove('loading');
        editImageButton.classList.remove('loading');
        upscaleImageButton.classList.remove('loading');
    }
}

// --- EVENT LISTENERS ---

// Lightbox Listeners
lightboxClose.addEventListener('click', () => {
    lightbox.classList.remove('is-visible');
});
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        lightbox.classList.remove('is-visible');
    }
});

// Theme Toggle Listener
themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark-mode');
});
// Check for saved theme preference
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark-mode');
}

// API Key Modal Listeners
apiKeyButton.addEventListener('click', () => showApiKeyModal());

apiKeyCloseButton.addEventListener('click', hideApiKeyModal);

apiKeyModal.addEventListener('click', (e) => {
    // only close if the overlay is clicked and the close button is visible
    if (e.target === apiKeyModal && apiKeyCloseButton.style.display !== 'none') {
        hideApiKeyModal();
    }
});

apiKeyAcceptButton.addEventListener('click', () => {
    saveAndSetApiKey(apiKeyInput.value.trim());
});

upload1.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  downloadButton.style.display = 'none';
  if (currentVideoBlobUrl) {
    URL.revokeObjectURL(currentVideoBlobUrl);
    currentVideoBlobUrl = null;
    videoEl.src = '';
  }
  if (file) {
    const nameParts = file.name.split('.');
    if (nameParts.length > 1) nameParts.pop(); // remove extension
    uploadedFileName = nameParts.join('.').toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'imagen-cargada';
    refImageEditCounter = 1;
    refImageVideoCounter = 1;

    fileNameEl1.textContent = file.name;
    base64data1 = await blobToBase64(file);
    mimeType1 = file.type;
    const dataUrl = `data:${mimeType1};base64,${base64data1}`;

    imgPreview1.onload = () => {
        if (maskCtx) {
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        }
        hasMask = false;
        drawPreviewMask();
        editTabButton.disabled = false;
        updateUI();
    }
    imgPreview1.src = dataUrl;
    editorWrapper.style.display = 'grid'; // Use grid to center
  } else {
     fileNameEl1.textContent = 'Ningún archivo seleccionado';
     imgPreview1.src = '';
     editorWrapper.style.display = 'none';
     base64data1 = '';
     mimeType1 = '';
     uploadedFileName = '';
     editedImageContainer.hidden = true;
     editedImageGrid.innerHTML = '';
     hasMask = false;
     drawPreviewMask();
     editTabButton.disabled = true;
     currentMode = 'generate'; // Revert to generate mode if image is removed
     downloadButton.style.display = 'none';
  }
  updateUI();
});

// Main Tab Listeners
mainTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        currentMode = tab.getAttribute('data-mode');
        updateUI();
    });
});

// Sub-Tab Listeners
generateSubTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        generateMode = tab.getAttribute('data-generate-mode');
        updateUI();
    });
});
editSubTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        editMode = tab.getAttribute('data-edit-mode');
        updateUI();
    });
});

creativitySlider.addEventListener('input', () => {
    creativityLevel = parseFloat(creativitySlider.value);
    if (creativityLevel < 0.3) {
        creativityValue.textContent = 'Preciso';
    } else if (creativityLevel > 0.7) {
        creativityValue.textContent = 'Creativo';
    } else {
        creativityValue.textContent = 'Medio';
    }
});


// Editor Modal Listeners
openEditorButton.addEventListener('click', openEditor);
editorCloseButton.addEventListener('click', closeEditor);
editorSaveButton.addEventListener('click', saveMaskFromEditor);
editorClearButton.addEventListener('click', () => {
    editorMaskCtx?.clearRect(0, 0, editorMaskCanvas.width, editorMaskCanvas.height);
});
editorBrushSizeSlider.addEventListener('input', () => {
    const size = editorBrushSizeSlider.value;
    editorBrushSizeValue.textContent = `${size}px`;
    if (editorMaskCtx) {
        editorMaskCtx.lineWidth = parseInt(size, 10);
    }
});
editorBrushToggle.addEventListener('click', () => setBrushMode(!isBrushActive));

zoomInButton.addEventListener('click', () => {
    const rect = editorViewport.getBoundingClientRect();
    zoomAtPoint(1, rect.width / 2, rect.height / 2);
});
zoomOutButton.addEventListener('click', () => {
    const rect = editorViewport.getBoundingClientRect();
    zoomAtPoint(-1, rect.width / 2, rect.height / 2);
});
zoomResetButton.addEventListener('click', resetEditorView);

editorViewport.addEventListener('wheel', handleZoom, { passive: false });
editorViewport.addEventListener('pointerdown', handleViewportPointerDown);
editorViewport.addEventListener('pointermove', handleViewportPointerMove);
editorViewport.addEventListener('pointerup', handleViewportPointerUp);
editorViewport.addEventListener('pointerleave', () => {
    stopPan();
    stopEditorDrawing();
    editorBrushCursor.style.display = 'none';
});
editorViewport.addEventListener('pointerenter', (e) => {
    if (isBrushActive) {
        updateBrushCursor(e);
        editorBrushCursor.style.display = 'block';
    }
});

promptEl.addEventListener('input', () => {
  prompt = promptEl.value;
  updateActionButtonsState();
});

imageCountSlider.addEventListener('input', () => {
    imageCountValue.textContent = imageCountSlider.value;
});

upscaleSlider.addEventListener('input', () => {
    upscaleValue.textContent = upscaleSlider.value;
});

safetyLevelSelect.addEventListener('change', () => {
    safetyWarning.hidden = safetyLevelSelect.value !== 'BLOCK_NONE';
});

// Main Download Button (for Video)
downloadButton.addEventListener('click', () => {
  if (currentVideoBlobUrl) {
    const a = document.createElement('a');
    a.href = currentVideoBlobUrl;
    a.download = currentVideoDownloadName || `yiyo-ai-video-default.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
});

// Action Button Listeners
generateVideoButton.addEventListener('click', () => generateVideo());
generateImageButton.addEventListener('click', () => generateImage());
editImageButton.addEventListener('click', () => editImage());
upscaleImageButton.addEventListener('click', () => upscaleImage());

enhancePromptButton.addEventListener('click', async () => {
    if (!apiKey) {
        showStatus('Por favor, configura tu API Key haciendo clic en "Registro".');
        showApiKeyModal();
        return;
    }
    const userPrompt = promptEl.value.trim();
    if (!userPrompt) return;

    enhancePromptButton.disabled = true;
    enhancePromptButton.classList.add('loading');
    const originalStatus = statusContainer.innerHTML;
    showLoading('Mejorando el prompt...');

    try {
        const ai = new GoogleGenAI({ apiKey });
        
        const systemInstruction = `Eres un asistente creativo especializado en escribir prompts para una IA de generación de video. Tu tarea es tomar la idea de un usuario y expandirla en un prompt vívido, descriptivo y cinematográfico. 
Enfócate en:
- **Detalles Visuales:** Describe la escena, personajes, objetos, colores y texturas.
- **Atmósfera y Ánimo:** Transmite la sensación de la escena (ej. misteriosa, alegre, épica).
- **Iluminación:** Especifica la hora del día, fuente de luz y calidad (ej. hora dorada, brillo de neón, sombras duras).
- **Trabajo de Cámara:** Sugiere ángulos de cámara, movimiento o tipos de toma (ej. toma amplia cinematográfica, travelling dinámico, primer plano).
- **Estilo:** Menciona estilos artísticos si es relevante (ej. hiperrealista, anime, acuarela).

La salida debe ser un único párrafo conciso. No incluyas ningún texto explicativo, preámbulos o texto adicional como "Aquí está el prompt mejorado:". Solo devuelve el prompt en sí.`;

        const safetySettings = getSafetySettings();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `User's idea: "${userPrompt}"`,
            config: {
                systemInstruction: systemInstruction,
                safetySettings,
            },
        });
        
        const enhancedText = response.text.trim();
        promptEl.value = enhancedText;
        prompt = enhancedText;
        
        statusContainer.innerHTML = originalStatus;
        
    } catch (e) {
        const errorMessage = getApiErrorMessage(e);
        showStatus(`Error: ${errorMessage}`);
        console.error('Error enhancing prompt:', e);
        setTimeout(() => {
            statusContainer.innerHTML = originalStatus;
        }, 5000);
    } finally {
        enhancePromptButton.disabled = false;
        enhancePromptButton.classList.remove('loading');
        updateActionButtonsState();
    }
});

function showVideoLoading(message, progress) {
    const progressText = progress !== undefined ? ` (${progress}%)` : '';
    const progressBarHTML = progress !== undefined
        ? `<div class="progress-bar-container"><div class="progress-bar" style="width: ${progress}%"></div></div>`
        : '';

    videoStatusContainer.innerHTML = `<div class="status-line"><div class="spinner"></div><p>${message}${progressText}</p></div>${progressBarHTML}`;
}

function showVideoStatus(message) {
    videoStatusContainer.innerHTML = `<p>${message}</p>`;
}

function showLoading(message, progress) {
    const progressText = progress !== undefined ? ` (${progress}%)` : '';
    const progressBarHTML = progress !== undefined
        ? `<div class="progress-bar-container"><div class="progress-bar" style="width: ${progress}%"></div></div>`
        : '';

    statusContainer.innerHTML = `<div class="status-line"><div class="spinner"></div><p id="status">${message}${progressText}</p></div>${progressBarHTML}`;
}

function showStatus(message) {
    statusContainer.innerHTML = `<p id="status">${message}</p>`;
}

function getApiErrorMessage(error) {
    if (error?.message === 'No videos generated') {
        return 'No se pudo generar el video. Esto puede deberse a las políticas de seguridad. Por favor, intenta con un prompt diferente.';
    }
    if (error?.message === 'El modelo no devolvió ninguna imagen.') {
        return error.message;
    }

    let messageSource = '';
    if (typeof error?.message === 'string') {
        messageSource = error.message;
    } else if (typeof error === 'string') {
        messageSource = error;
    } else if (typeof error?.toString === 'function' && error.toString() !== '[object Object]') {
        messageSource = error.toString();
    }

    const jsonMatch = messageSource.match(/{.+}/s);
    if (jsonMatch) {
        try {
            const errorObj = JSON.parse(jsonMatch[0]);
            if (errorObj.error) {
                const detail = errorObj.error;
                if (detail.status === 'RESOURCE_EXHAUSTED') {
                    return `Límite de cuota excedido. Por favor, revisa tu plan y los detalles de facturación de la API de Google AI.`;
                }
                if (detail.message) {
                    return detail.message;
                }
            }
        } catch (e) {}
    }

    if (messageSource.includes('API key not valid')) {
        return 'API Key no válida. Por favor, revisa tu clave en la sección de "Registro".';
    }

    if (messageSource) return messageSource;
    return 'Ocurrió un error inesperado. Por favor, inténtalo de nuevo.';
}

function getSafetySettings() {
    const selectedThreshold = safetyLevelSelect.value;
    return [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: selectedThreshold },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: selectedThreshold },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: selectedThreshold },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: selectedThreshold },
    ];
}

/**
 * Creates a single source image for inpainting by punching a transparent hole
 * in the original image based on the user's mask.
 * @param originalBase64 The base64 string of the original image.
 * @param originalMimeType The MIME type of the original image.
 * @param maskCanvasEl The canvas element containing the user's drawn mask.
 * @returns A promise that resolves to the base64 string of the new source image.
 */
async function prepareInpaintingSource(originalBase64, originalMimeType, maskCanvasEl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not get canvas context for inpainting prep'));

            // 1. Draw the original image
            ctx.drawImage(img, 0, 0);

            // 2. Use the mask to create a transparent hole. 'destination-out' keeps the original image
            // pixels only where they do NOT overlap with the mask drawing.
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(maskCanvasEl, 0, 0, img.naturalWidth, img.naturalHeight);

            resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = reject;
        img.src = `data:${originalMimeType};base64,${originalBase64}`;
    });
}


async function handleRetry(e, attempt, isVideo = false) {
    const show = isVideo ? showVideoStatus : showStatus;
    const errorMessage = getApiErrorMessage(e);
    if (attempt < MAX_RETRIES) {
        show(`Error: ${errorMessage}. Reintentando en 5 segundos...`);
        await delay(5000);
    } else {
        show(`Error: ${errorMessage}. Se alcanzó el número máximo de reintentos.`);
        setLoadingState(false); // Make sure to stop loading on final failure
    }
}

async function generateImage() {
    if (!apiKey) {
        showStatus('Por favor, configura tu API Key haciendo clic en "Registro".');
        showApiKeyModal();
        return;
    }
    videoStatusContainer.innerHTML = '';
    downloadButton.style.display = 'none';
    if (currentVideoBlobUrl) {
        URL.revokeObjectURL(currentVideoBlobUrl);
        currentVideoBlobUrl = null;
    }
    if (!prompt) {
        showStatus('Por favor, escribe un prompt para poder generar una imagen.');
        return;
    }

    const imageCount = parseInt(imageCountSlider.value, 10);
    const selectedAspectRatio = document.querySelector('input[name="aspect-ratio"]:checked').value;

    setLoadingState(true);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            showLoading(`Generando ${imageCount} imágen(es)... (Intento ${attempt}/${MAX_RETRIES})`);
            editedImageContainer.hidden = true;
            editedImageGrid.innerHTML = '';

            const ai = new GoogleGenAI({ apiKey });
            
            // FIX: The 'safetySettings' property is not valid for the 'generateImages' config.
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: prompt,
                config: {
                  numberOfImages: imageCount,
                  outputMimeType: 'image/png',
                  aspectRatio: selectedAspectRatio,
                },
            });
            
            if (response.generatedImages && response.generatedImages.length > 0) {
                response.generatedImages.forEach((generatedImage, index) => {
                    const base64ImageBytes = generatedImage.image.imageBytes;
                    const imageUrl = `data:image/png;base64,${base64ImageBytes}`;
                    const fileName = `YiyoAI-imagen(${promptOnlyImageCounter++}).png`;
                    const itemContainer = createImageResultItem(imageUrl, `Resultado de la imagen generada ${index + 1}`, fileName);
                    editedImageGrid.appendChild(itemContainer);
                });

                editedImageContainer.hidden = false;
                showStatus(`¡${response.generatedImages.length} de ${imageCount} imágenes generadas con éxito!`);
                break;
            } else {
                throw new Error('El modelo no devolvió ninguna imagen.');
            }
        } catch (e) {
            await handleRetry(e, attempt, false);
        }
    }
    setLoadingState(false);
}

async function editImage() {
    if (!apiKey) {
        showStatus('Por favor, configura tu API Key haciendo clic en "Registro".');
        showApiKeyModal();
        return;
    }
    videoStatusContainer.innerHTML = '';
    downloadButton.style.display = 'none';
    if (currentVideoBlobUrl) {
        URL.revokeObjectURL(currentVideoBlobUrl);
        currentVideoBlobUrl = null;
    }
    if (!base64data1) {
        showStatus('Por favor, sube una imagen y escribe un prompt para poder editar.');
        return;
    }
    if (editMode === 'inpaint' && !hasMask) {
        showStatus('Por favor, abre el editor y dibuja una máscara para indicar qué área editar.');
        return;
    }

    setLoadingState(true);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            showLoading(`Editando imagen... (Intento ${attempt}/${MAX_RETRIES})`);
            editedImageContainer.hidden = true;
            editedImageGrid.innerHTML = '';

            const ai = new GoogleGenAI({ apiKey });
            const safetySettings = getSafetySettings();
            let parts = [];
            let systemPrompt = '';
            
            if (editMode === 'ia') {
                 systemPrompt = `You are an expert image editor. Fully transform the following image based on this instruction, acting as if it were an image generation prompt. User's instruction: "${prompt}"`;
                 parts.push({ text: systemPrompt });
                 parts.push({ inlineData: { data: base64data1, mimeType: mimeType1 } });
            } else if (editMode === 'inpaint') {
                showLoading(`Preparando imagen con máscara...`);
                const sourceImageForApiBase64 = await prepareInpaintingSource(base64data1, mimeType1, maskCanvas);

                const creativityInstruction = creativityLevel < 0.3
                    ? "El reemplazo debe ser estrictamente fotorrealista, coincidiendo perfectamente con la iluminación, las sombras, la textura y la perspectiva de la imagen original."
                    : creativityLevel > 0.7
                    ? "Sé creativo e imaginativo dentro del área rellenada, pero asegúrate de que el resultado final se mezcle artísticamente con el resto de la imagen."
                    : "El nuevo contenido debe integrarse de manera fluida y creíble con las partes no transparentes de la imagen original.";

                systemPrompt = `Eres un editor de imágenes experto especializado en inpainting. Se te proporcionará una única imagen PNG que contiene un área transparente.
- Tu ÚNICA tarea es rellenar de forma realista el área transparente de la imagen basándote en el prompt del usuario.
- NO DEBES cambiar ninguna de las partes no transparentes (opacas) de la imagen.
- El resultado final DEBE ser una imagen completamente opaca con el área previamente transparente rellenada.
- ${creativityInstruction}
Instrucción del usuario: "${prompt}"`;
                
                showLoading(`Retocando imagen... (Intento ${attempt}/${MAX_RETRIES})`);
                
                parts.push({ text: systemPrompt });
                parts.push({ inlineData: { data: sourceImageForApiBase64, mimeType: 'image/png' } });
            }

            const params = {
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts },
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                    safetySettings,
                },
            };
            
            const response = await ai.models.generateContent(params);
            const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
            
            if (imagePart?.inlineData) {
                const generatedBase64 = imagePart.inlineData.data;
                const finalImageUrl = `data:image/png;base64,${generatedBase64}`;
                
                const fileName = `YiyoAI-edited-${uploadedFileName}(${refImageEditCounter++}).png`;
                const item = createImageResultItem(finalImageUrl, 'Resultado de la imagen editada', fileName);
                editedImageGrid.appendChild(item);

                editedImageContainer.hidden = false;
                showStatus(`¡Imagen editada con éxito!`);
                break;
            } else {
                throw new Error('El modelo no devolvió ninguna imagen.');
            }

        } catch (e) {
            await handleRetry(e, attempt, false);
        }
    }
    setLoadingState(false);
}

async function upscaleImage() {
    if (!apiKey) {
        showStatus('Por favor, configura tu API Key haciendo clic en "Registro".');
        showApiKeyModal();
        return;
    }
    videoStatusContainer.innerHTML = '';
    downloadButton.style.display = 'none';
    if (currentVideoBlobUrl) {
        URL.revokeObjectURL(currentVideoBlobUrl);
        currentVideoBlobUrl = null;
    }
    if (!base64data1) {
        showStatus('Por favor, sube una imagen para poder ampliarla.');
        return;
    }

    setLoadingState(true);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const upscalePercentage = parseInt(upscaleSlider.value, 10);
            const targetWidth = Math.round(imgPreview1.naturalWidth * (upscalePercentage / 100));
            const targetHeight = Math.round(imgPreview1.naturalHeight * (upscalePercentage / 100));

            showLoading(`Ampliando imagen a ${upscalePercentage}%... (Intento ${attempt}/${MAX_RETRIES})`);
            editedImageContainer.hidden = true;
            editedImageGrid.innerHTML = '';
            
            const finalPrompt = `Upscale this image to ${targetWidth} x ${targetHeight} pixels. Enhance the resolution, making it sharper and more detailed, while preserving the original content, style, and aspect ratio. Do not add, remove, or change any elements in the image.`;
            
            const ai = new GoogleGenAI({ apiKey });
            const safetySettings = getSafetySettings();
            
            const parts = [
                { text: finalPrompt },
                { inlineData: { data: base64data1, mimeType: mimeType1 } },
            ];

            const params = {
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts },
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                    safetySettings,
                },
            };
            
            const response = await ai.models.generateContent(params);
            const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
            
            if (imagePart?.inlineData) {
                const unresizedUrl = `data:image/png;base64,${imagePart.inlineData.data}`;
                const imageUrl = await resizeImageToDimensions(unresizedUrl, targetWidth, targetHeight);
                const fileName = `YiyoAI-edited-${uploadedFileName}(${refImageEditCounter++}).png`;
                const item = createImageResultItem(imageUrl, 'Resultado de la imagen ampliada', fileName);
                editedImageGrid.appendChild(item);

                editedImageContainer.hidden = false;
                showStatus(`¡Imagen ampliada a ${upscalePercentage}% con éxito!`);
                break;
            } else {
                throw new Error('El modelo no devolvió ninguna imagen.');
            }
        } catch (e) {
            await handleRetry(e, attempt, false);
        }
    }
    setLoadingState(false);
}

async function generateVideo() {
  if (!apiKey) {
      showStatus('Por favor, configura tu API Key haciendo clic en "Registro".');
      showApiKeyModal();
      return;
  }
  const selectedRadioValue = document.querySelector('input[name="aspect-ratio-video"]:checked').value;
  const isTall = ['3:4', '9:16'].includes(selectedRadioValue);
  const targetAspectRatio = isTall ? '9:16' : '16:9';
  
  updateVideoContainerAspectRatio(targetAspectRatio);

  statusContainer.innerHTML = '';
  downloadButton.style.display = 'none';
  if (currentVideoBlobUrl) {
    URL.revokeObjectURL(currentVideoBlobUrl);
    currentVideoBlobUrl = null;
  }
  videoEl.src = '';
  videoContainer.style.display = 'none';

  if (!prompt) {
    showVideoStatus('Por favor, escribe un prompt para poder generar un video.');
    return;
  }

  setLoadingState(true);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      showVideoLoading(`Iniciando generación de video... (Intento ${attempt}/${MAX_RETRIES})`);

      const ai = new GoogleGenAI({ apiKey });
      
      const params = {
        model: 'veo-2.0-generate-001',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
        },
      };
      
      if (base64data1 && mimeType1) {
        const { base64: resizedBase64, mimeType: resizedMimeType } = await resizeImageToFitAspectRatio(base64data1, mimeType1, targetAspectRatio);
        params.image = {
          imageBytes: resizedBase64,
          mimeType: resizedMimeType,
        };
      }
      
      let operation = await ai.models.generateVideos(params);
      let progress = 0;
      
      const pollingMessages = [
          "Preparando los recursos de cómputo...",
          "Analizando el prompt y la imagen...",
          "Generando los fotogramas iniciales...",
          "Renderizando la secuencia de video...",
          "Aplicando los toques finales...",
          "Casi listo, compilando el video...",
      ];
      let messageIndex = 0;
      showVideoLoading(pollingMessages[messageIndex], progress);

      while (!operation.done) {
        await delay(10000); 
        operation = await ai.operations.getVideosOperation({ operation: operation });
        
        if (operation.metadata?.progressPercentage) {
            progress = Math.round(operation.metadata.progressPercentage);
        } else {
            progress = Math.min(99, progress + 5); 
        }

        messageIndex = (messageIndex + 1) % pollingMessages.length;
        showVideoLoading(pollingMessages[messageIndex], progress);
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;

      if (downloadLink) {
        showVideoLoading('Video generado. Descargando...', 100);
        const response = await fetch(`${downloadLink}&key=${apiKey}`);
        if (!response.ok) {
            throw new Error(`Error al descargar el video: ${response.statusText}`);
        }
        const videoBlob = await response.blob();
        currentVideoBlobUrl = URL.createObjectURL(videoBlob);
        videoEl.src = currentVideoBlobUrl;
        
        if (params.image) {
            currentVideoDownloadName = `YiyoAI-video-${uploadedFileName}(${refImageVideoCounter++}).mp4`;
        } else {
            currentVideoDownloadName = `YiyoAI-video(${promptOnlyVideoCounter++}).mp4`;
        }
        
        videoContainer.style.display = 'block';
        downloadButton.style.display = 'inline-flex';
        
        showVideoStatus('¡Video generado y listo para reproducir!');
        break; 
      } else {
        throw new Error('No videos generated');
      }

    } catch (e) {
      await handleRetry(e, attempt, true);
    }
  }
  setLoadingState(false);
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }).catch(error => {
      console.log('ServiceWorker registration failed: ', error);
    });
  });
}

// Initial App setup
function initializeApp() {
    const savedKey = localStorage.getItem('YIYO_AI_API_KEY');
    if (savedKey) {
        apiKey = savedKey;
        apiKeyInput.value = savedKey;
    } else {
        showApiKeyModal();
    }
    updateUI();
}

initializeApp();
