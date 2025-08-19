import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';

interface CanvasAutoGenSettings {
	autoGenerateOnOpen: boolean;
	autoOpenCanvas: boolean;
	canvasWidth: number;
	canvasHeight: number;
	linkDepth: number;
	autoExpandCanvas: boolean; // New setting for automatic expansion
}

const DEFAULT_SETTINGS: CanvasAutoGenSettings = {
	autoGenerateOnOpen: false, // Disabled by default to prevent interference
	autoOpenCanvas: true, // Open canvas after creation
	canvasWidth: 800,
	canvasHeight: 600,
	linkDepth: 1, // Default to 1 level of depth
	autoExpandCanvas: true // Enable automatic expansion by default
}

export default class CanvasAutoGenPlugin extends Plugin {
	settings: CanvasAutoGenSettings;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon for manual canvas generation
		const ribbonIconEl = this.addRibbonIcon('canvas', 'Generate Canvas for Active Note', (evt: MouseEvent) => {
			this.generateCanvasForActiveNote();
		});
		ribbonIconEl.addClass('canvas-auto-gen-ribbon-class');

		// Add command for manual canvas generation
		this.addCommand({
			id: 'generate-canvas-for-active-note',
			name: 'Generate Canvas for Active Note',
			callback: () => {
				this.generateCanvasForActiveNote();
			}
		});

		// Add command that only works when a markdown file is active
		this.addCommand({
			id: 'generate-canvas-for-active-note-complex',
			name: 'Generate Canvas for Active Note (Complex)',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.generateCanvasForActiveNote();
					}
					return true;
				}
				return false;
			}
		});

		// Add command to generate canvas for any file
		this.addCommand({
			id: 'generate-canvas-for-file',
			name: 'Generate Canvas for File',
			callback: () => {
				this.generateCanvasForActiveNote();
			}
		});

		// Add command to manually trigger canvas expansion
		this.addCommand({
			id: 'expand-canvas-manually',
			name: 'Expand Canvas Manually',
			callback: () => {
				this.expandCanvasManually();
			}
		});

		// Note: Canvas context menu integration requires Obsidian API support
		// This feature will be available when the API supports it

		// Auto-generate canvas when opening files (if enabled)
		if (this.settings.autoGenerateOnOpen) {
			this.registerEvent(
				this.app.workspace.on('file-open', (file: TFile | null) => {
					if (file && file.extension === 'md') {
						// Small delay to ensure the file is fully loaded
						setTimeout(() => {
							this.generateCanvasForActiveNote();
						}, 100);
					}
				})
			);
		}

		// Note: Automatic canvas expansion is disabled due to API limitations
		// Use the "Expand Canvas Manually" command instead

		// Add automatic canvas expansion if enabled
		if (this.settings.autoExpandCanvas) {
			this.setupAutomaticExpansion();
		}

		// Add settings tab
		this.addSettingTab(new CanvasAutoGenSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup if needed
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async generateCanvasForActiveNote() {
		// Check if we're currently in a canvas view - if so, don't generate a new canvas
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf && activeLeaf.view) {
			const activeFile = (activeLeaf.view as any).file;
			if (activeFile && activeFile.path.endsWith('.canvas')) {
				// We're in a canvas view, don't generate a new canvas
				return;
			}
		}

		// Try multiple ways to get the active file
		let activeFile: TFile | null = null;
		
		// Method 1: Get from active view
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			activeFile = activeView.file;
		}
		
		// Method 2: Get from workspace active file
		if (!activeFile) {
			activeFile = this.app.workspace.getActiveFile();
		}
		
		if (!activeFile) {
			new Notice('No active markdown file found. Please open a markdown file first.');
			return;
		}
		
		// Check if it's a markdown file
		if (activeFile.extension !== 'md') {
			new Notice('Active file is not a markdown file. Please open a .md file.');
			return;
		}

		try {
			// Create a new canvas file
			const canvasFileName = `${activeFile.basename}_canvas`;
			// Normalize path to avoid leading or double slashes
			const parentPath = activeFile.parent?.path ?? '';
			const normalizedDir = parentPath.replace(/\\+/g, '/').replace(/^\/+|\/+$|(^\.$)/g, '');
			const canvasPath = normalizedDir ? `${normalizedDir}/${canvasFileName}.canvas` : `${canvasFileName}.canvas`;
			
			// Check if canvas already exists
			const existingCanvas = this.app.vault.getAbstractFileByPath(canvasPath);
			if (existingCanvas) {
				if (this.settings.autoOpenCanvas) {
					new Notice(`Canvas already exists: ${canvasFileName}.canvas - Opening in new tab`);
					// Open the existing canvas in a new tab
					await this.app.workspace.openLinkText(canvasPath, '', false);
				} else {
					new Notice(`Canvas already exists: ${canvasFileName}.canvas`);
				}
				return;
			}

			// Create canvas content
			const canvasContent = this.createCanvasContent(activeFile);
			
			// Create the canvas file
			await this.app.vault.create(canvasPath, canvasContent);
			
			// Open the new canvas if setting is enabled
			if (this.settings.autoOpenCanvas) {
				await this.app.workspace.openLinkText(canvasPath, '', false);
			}
			
			new Notice(`Canvas generated: ${canvasFileName}.canvas`);
		} catch (error) {
			console.error('Error generating canvas:', error);
			new Notice('Error generating canvas');
		}
	}

	createCanvasContent(activeFile: TFile): string {
		// Get all nodes and their connections
		const { nodes: allNodes, connections } = this.getAllNodesAndConnections(activeFile, this.settings.linkDepth);
		
		// Organize nodes into layers for better layout
		const layers = this.organizeNodesIntoLayers(activeFile, allNodes, connections);
		
		// Calculate positions using layered layout
		const nodeWidth = 300;
		const nodeHeight = 200;
		const horizontalSpacing = 450; // Space between layers
		const verticalSpacing = 280; // Space between nodes in same layer
		
		// Create nodes array starting with center node
		const nodes = [
			{
				id: "center-node",
				type: "file",
				file: activeFile.path,
				x: this.settings.canvasWidth / 2,
				y: this.settings.canvasHeight / 2,
				width: nodeWidth,
				height: nodeHeight
			}
		];
		
		// Create a map of file paths to node IDs for edge creation
		const fileToNodeId = new Map<string, string>();
		fileToNodeId.set(activeFile.path, "center-node");
		
		// Position nodes in layers
		let nodeIndex = 0;
		
		// Debug: Log the layers structure
		console.log('Layers structure:', layers.map((layer, i) => `Layer ${i}: ${layer.length} nodes`));
		
		// Find the center layer index (the layer containing the center node)
		const centerLayerIndex = layers.findIndex(layer => 
			layer.some(node => node.file.path === activeFile.path)
		);
		
		for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
			const layer = layers[layerIndex];
			
			// Calculate horizontal position for this layer
			let layerX: number;
			if (layerIndex === centerLayerIndex) {
				// Center layer - center node
				layerX = this.settings.canvasWidth / 2;
			} else {
				// Calculate offset relative to center layer
				const relativeOffset = layerIndex - centerLayerIndex;
				const offset = relativeOffset * horizontalSpacing;
				layerX = this.settings.canvasWidth / 2 + offset;
			}
			
			// Calculate vertical positions for nodes in this layer
			const totalLayerHeight = (layer.length - 1) * verticalSpacing;
			const layerStartY = this.settings.canvasHeight / 2 - totalLayerHeight / 2;
			
			for (let nodeInLayerIndex = 0; nodeInLayerIndex < layer.length; nodeInLayerIndex++) {
				const nodeInfo = layer[nodeInLayerIndex];
				if (nodeInfo.file.path !== activeFile.path) { // Skip center node
					const nodeId = `node-${nodeIndex++}`;
					fileToNodeId.set(nodeInfo.file.path, nodeId);
					
					const nodeY = layerStartY + nodeInLayerIndex * verticalSpacing;
					
					nodes.push({
						id: nodeId,
						type: "file",
						file: nodeInfo.file.path,
						x: layerX,
						y: nodeY,
						width: nodeWidth,
						height: nodeHeight
					});
				}
			}
		}
		
		// Create edges (arrows) for all connections
		const edges: any[] = [];
		let edgeIndex = 0;
		
		// Add all connections between nodes
		for (const [fromPath, toPaths] of connections.entries()) {
			const fromNodeId = fileToNodeId.get(fromPath);
			if (fromNodeId) {
				for (const toPath of toPaths) {
					const toNodeId = fileToNodeId.get(toPath);
					if (toNodeId && fromNodeId !== toNodeId) {
						edges.push({
							id: `edge-${edgeIndex++}`,
							fromNode: fromNodeId,
							fromSide: "right",
							toNode: toNodeId,
							toSide: "left"
						});
					}
				}
			}
		}
		
		const canvasData = {
			nodes: nodes,
			edges: edges,
			meta: {
				created: new Date().toISOString(),
				modified: new Date().toISOString()
			}
		};

		return JSON.stringify(canvasData, null, 2);
	}
	
	getBacklinks(file: TFile): TFile[] {
		const backlinks = this.app.metadataCache.resolvedLinks;
		const backlinkFiles: TFile[] = [];
		
		// Find all files that link to the current file
		for (const [sourcePath, links] of Object.entries(backlinks)) {
			if (links[file.path]) {
				const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
				if (sourceFile && sourceFile instanceof TFile && sourceFile.extension === 'md') {
					backlinkFiles.push(sourceFile);
				}
			}
		}
		
		return backlinkFiles;
	}
	
	getForwardLinks(file: TFile): TFile[] {
		const forwardLinks: TFile[] = [];
		const links = this.app.metadataCache.resolvedLinks[file.path];
		
		if (links) {
			for (const [targetPath, count] of Object.entries(links)) {
				const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
				if (targetFile && targetFile instanceof TFile && targetFile.extension === 'md') {
					forwardLinks.push(targetFile);
				}
			}
		}
		
		return forwardLinks;
	}

	getAllNodesAndConnections(centerFile: TFile, depth: number): {
		nodes: Array<{file: TFile, level: number, isBacklink: boolean}>,
		connections: Map<string, Set<string>>
	} {
		const visited = new Set<string>();
		const nodes: Array<{file: TFile, level: number, isBacklink: boolean}> = [];
		const connections = new Map<string, Set<string>>();
		
		// Add center node
		nodes.push({file: centerFile, level: 0, isBacklink: false});
		visited.add(centerFile.path);
		connections.set(centerFile.path, new Set<string>());
		
		// Explore all connections up to specified depth
		this.exploreAllConnections(centerFile, depth, 1, visited, nodes, connections);
		
		return { nodes, connections };
	}

	organizeNodesIntoLayers(
		centerFile: TFile, 
		allNodes: Array<{file: TFile, level: number, isBacklink: boolean}>, 
		connections: Map<string, Set<string>>
	): Array<Array<{file: TFile, level: number, isBacklink: boolean}>> {
		// Create separate layers for backlinks (left) and forward links (right)
		const backlinkLayers: Array<Array<{file: TFile, level: number, isBacklink: boolean}>> = [];
		const forwardLinkLayers: Array<Array<{file: TFile, level: number, isBacklink: boolean}>> = [];
		
		// Find the maximum level for both backlinks and forward links
		const maxBacklinkLevel = Math.max(...allNodes.filter(node => node.isBacklink).map(node => node.level), 0);
		const maxForwardLinkLevel = Math.max(...allNodes.filter(node => !node.isBacklink).map(node => node.level), 0);
		
		// Create layers for backlinks (left side)
		for (let level = 0; level <= maxBacklinkLevel; level++) {
			backlinkLayers.push([]);
		}
		
		// Create layers for forward links (right side)
		for (let level = 0; level <= maxForwardLinkLevel; level++) {
			forwardLinkLayers.push([]);
		}
		
		// Add center node to both layer arrays at index 0 (will be used for positioning)
		backlinkLayers[0].push({file: centerFile, level: 0, isBacklink: false});
		forwardLinkLayers[0].push({file: centerFile, level: 0, isBacklink: false});
		
		// Add other nodes to their respective layers based on their level and backlink status
		allNodes.forEach(node => {
			if (node.file.path !== centerFile.path) {
				if (node.isBacklink) {
					// Backlinks go to the left
					if (node.level < backlinkLayers.length) {
						backlinkLayers[node.level].push(node);
					}
				} else {
					// Forward links go to the right
					if (node.level < forwardLinkLayers.length) {
						forwardLinkLayers[node.level].push(node);
					}
				}
			}
		});
		
		// Sort nodes within each layer
		backlinkLayers.forEach(layer => {
			layer.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
		});
		
		forwardLinkLayers.forEach(layer => {
			layer.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
		});
		
		// Combine layers: backlinks first (left), then forward links (right)
		const combinedLayers: Array<Array<{file: TFile, level: number, isBacklink: boolean}>> = [];
		
		// Add backlink layers (left side)
		for (let i = backlinkLayers.length - 1; i >= 0; i--) {
			if (backlinkLayers[i].length > 0) {
				combinedLayers.push(backlinkLayers[i]);
			}
		}
		
		// Add forward link layers (right side)
		for (let i = 0; i < forwardLinkLayers.length; i++) {
			if (forwardLinkLayers[i].length > 0) {
				combinedLayers.push(forwardLinkLayers[i]);
			}
		}
		
		return combinedLayers;
	}

	async expandCanvas(canvasFile: TFile, focusNote: TFile, direction: 'left' | 'right') {
		console.log(`Expanding canvas ${direction} from note: ${focusNote.basename}`);
		
		// Read current canvas
		const currentContent = await this.app.vault.read(canvasFile);
		let canvasData;
		try {
			canvasData = JSON.parse(currentContent);
		} catch (e) {
			console.error('Failed to parse canvas data:', e);
			return;
		}

		// Get new connections based on direction
		const newConnections = direction === 'left' 
			? this.getBacklinks(focusNote)
			: this.getForwardLinks(focusNote);

		console.log(`Found ${newConnections.length} new connections for ${direction} expansion`);

		// Add new nodes that aren't already in the canvas
		const existingPaths = new Set(canvasData.nodes.map((n: any) => n.file));
		const newNodes = [];
		const horizontalSpacing = 450;
		const verticalSpacing = 280; // Space between nodes vertically
		const nodeWidth = 300;
		const nodeHeight = 200;

		// Filter out nodes that already exist in the canvas
		const nodesToAdd = newConnections.filter(linkedFile => !existingPaths.has(linkedFile.path));
		
		if (nodesToAdd.length === 0) {
			console.log('No new nodes to add');
			return;
		}

		// Find the focus node's position
		const focusNode = canvasData.nodes.find((n: any) => n.file === focusNote.path);
		if (!focusNode) {
			console.log(`Could not find focus node for ${focusNote.path}`);
			return;
		}

		// Calculate target X position for new nodes
		const targetX = focusNode.x + (direction === 'left' ? -horizontalSpacing : horizontalSpacing);

		// Find existing nodes at the target X position (with some tolerance)
		const existingNodesAtTargetX = canvasData.nodes.filter((n: any) => {
			const xDistance = Math.abs(n.x - targetX);
			return xDistance < (nodeWidth + 100); // 100px tolerance
		});

		console.log(`Found ${existingNodesAtTargetX.length} existing nodes at target X position ${targetX}`);

		// Calculate optimal Y positions for new nodes
		const newNodePositions: { x: number, y: number }[] = [];
		
		// Start with the ideal position (centered around focus node)
		let idealStartY = focusNode.y - ((nodesToAdd.length - 1) * verticalSpacing) / 2;
		
		// For each new node, find the best available Y position
		for (let i = 0; i < nodesToAdd.length; i++) {
			const idealY = idealStartY + i * verticalSpacing;
			let bestY = idealY;
			
			// Check if this position conflicts with existing nodes
			const conflicts = existingNodesAtTargetX.filter((existingNode: any) => {
				const existingTop = existingNode.y - nodeHeight / 2 - 20; // 20px buffer
				const existingBottom = existingNode.y + nodeHeight / 2 + 20;
				const newNodeTop = bestY - nodeHeight / 2;
				const newNodeBottom = bestY + nodeHeight / 2;
				
				return newNodeTop < existingBottom && newNodeBottom > existingTop;
			});
			
			if (conflicts.length > 0) {
				// Find the best alternative position
				const conflict = conflicts[0];
				const conflictY = conflict.y;
				
				// Try positions above the conflict
				let tryY = conflictY - nodeHeight - verticalSpacing;
				let aboveConflicts = existingNodesAtTargetX.filter((existingNode: any) => {
					const existingTop = existingNode.y - nodeHeight / 2 - 20;
					const existingBottom = existingNode.y + nodeHeight / 2 + 20;
					const newNodeTop = tryY - nodeHeight / 2;
					const newNodeBottom = tryY + nodeHeight / 2;
					return newNodeTop < existingBottom && newNodeBottom > existingTop;
				});
				
				if (aboveConflicts.length === 0) {
					bestY = tryY;
				} else {
					// Try positions below the conflict
					tryY = conflictY + nodeHeight + verticalSpacing;
					const belowConflicts = existingNodesAtTargetX.filter((existingNode: any) => {
						const existingTop = existingNode.y - nodeHeight / 2 - 20;
						const existingBottom = existingNode.y + nodeHeight / 2 + 20;
						const newNodeTop = tryY - nodeHeight / 2;
						const newNodeBottom = tryY + nodeHeight / 2;
						return newNodeTop < existingBottom && newNodeBottom > existingTop;
					});
					
					if (belowConflicts.length === 0) {
						bestY = tryY;
					} else {
						// If both above and below are occupied, find the closest free position
						const allYPositions = existingNodesAtTargetX.map((n: any) => n.y).sort((a: number, b: number) => a - b);
						let foundPosition = false;
						
						for (let j = 0; j < allYPositions.length - 1; j++) {
							const gapStart = allYPositions[j] + nodeHeight / 2 + verticalSpacing;
							const gapEnd = allYPositions[j + 1] - nodeHeight / 2 - verticalSpacing;
							
							if (gapEnd - gapStart >= nodeHeight) {
								// Found a gap big enough
								bestY = gapStart + (gapEnd - gapStart) / 2;
								foundPosition = true;
								break;
							}
						}
						
						if (!foundPosition) {
							// Place at the end
							const maxY = Math.max(...allYPositions);
							bestY = maxY + nodeHeight + verticalSpacing;
						}
					}
				}
			}
			
			newNodePositions.push({ x: targetX, y: bestY });
		}

		// Create and add the new nodes
		for (let i = 0; i < nodesToAdd.length; i++) {
			const linkedFile = nodesToAdd[i];
			const position = newNodePositions[i];
			
			// Create new node
			const newNode = {
				id: `node-${Date.now()}-${Math.random()}`,
				type: "file",
				file: linkedFile.path,
				x: position.x,
				y: position.y,
				width: nodeWidth,
				height: nodeHeight
			};

			newNodes.push(newNode);

			// Add edge from focus node to new node
			const newEdge = {
				id: `edge-${Date.now()}-${Math.random()}`,
				fromNode: direction === 'left' ? newNode.id : focusNode.id,
				fromSide: "right" as const,
				toNode: direction === 'left' ? focusNode.id : newNode.id,
				toSide: "left" as const
			};

			canvasData.nodes.push(newNode);
			canvasData.edges.push(newEdge);
			
			console.log(`Added new node: ${linkedFile.basename} at (${position.x}, ${position.y})`);
		}

		// Update canvas file
		if (newNodes.length > 0) {
			canvasData.meta.modified = new Date().toISOString();
			await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, 2));
			
			console.log(`Added ${newNodes.length} new nodes to canvas`);
			
			// Force refresh the canvas view
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf && activeLeaf.view && (activeLeaf.view as any).file?.path === canvasFile.path) {
				// Try multiple ways to refresh the canvas
				try {
					(activeLeaf.view as any).canvas?.requestSave();
					(activeLeaf.view as any).canvas?.loadData();
					(activeLeaf.view as any).canvas?.redraw();
				} catch (e) {
					console.log('Canvas refresh methods not available');
				}
			}
		} else {
			console.log('No new nodes to add');
		}
	}

	async expandCanvasManually() {
		try {
			// Check if we're currently in a canvas view
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf || !activeLeaf.view) {
				new Notice('Please open a canvas to expand it.');
				return;
			}
			
			// Check if the active view is a canvas view by checking the file extension
			const activeFile = (activeLeaf.view as any).file;
			if (!activeFile || !activeFile.path.endsWith('.canvas')) {
				new Notice('Please open a canvas to expand it.');
				return;
			}

			// Get the canvas file
			const canvasFile = activeFile;

			// Extract the original note name from canvas filename
			const canvasName = canvasFile.basename;
			const originalNoteName = canvasName.replace('_canvas', '');
			
			// Find the original note
			const originalNote = this.app.vault.getAbstractFileByPath(`${originalNoteName}.md`);
			if (!originalNote || !(originalNote instanceof TFile)) {
				new Notice('Could not find the original note for this canvas.');
				return;
			}

			// Read current canvas content
			const currentContent = await this.app.vault.read(canvasFile);
			let canvasData;
			try {
				canvasData = JSON.parse(currentContent);
			} catch (e) {
				new Notice('Invalid canvas data.');
				return;
			}

			// Get all existing file paths in the canvas
			const existingPaths = new Set(canvasData.nodes.map((n: any) => n.file));
			let expanded = false;

			// Try to expand from all nodes that have connections
			for (const node of canvasData.nodes) {
				const nodeNote = this.app.vault.getAbstractFileByPath(node.file);
				if (!nodeNote || !(nodeNote instanceof TFile)) continue;

				// Get forward links from this node
				const forwardLinks = this.getForwardLinks(nodeNote);
				const newForwardLinks = forwardLinks.filter(link => !existingPaths.has(link.path));
				
				if (newForwardLinks.length > 0) {
					console.log(`Found ${newForwardLinks.length} new forward links from ${nodeNote.basename}`);
					await this.expandCanvas(canvasFile, nodeNote, 'right');
					expanded = true;
					// Update existing paths after expansion
					const updatedContent = await this.app.vault.read(canvasFile);
					const updatedData = JSON.parse(updatedContent);
					updatedData.nodes.forEach((n: any) => existingPaths.add(n.file));
				}

				// Get backlinks to this node
				const backlinks = this.getBacklinks(nodeNote);
				const newBacklinks = backlinks.filter(link => !existingPaths.has(link.path));
				
				if (newBacklinks.length > 0) {
					console.log(`Found ${newBacklinks.length} new backlinks to ${nodeNote.basename}`);
					await this.expandCanvas(canvasFile, nodeNote, 'left');
					expanded = true;
					// Update existing paths after expansion
					const updatedContent = await this.app.vault.read(canvasFile);
					const updatedData = JSON.parse(updatedContent);
					updatedData.nodes.forEach((n: any) => existingPaths.add(n.file));
				}
			}

			if (expanded) {
				new Notice('Canvas expanded successfully!');
			} else {
				new Notice('No new connections found to expand the canvas.');
			}

		} catch (error) {
			console.error('Error expanding canvas manually:', error);
			new Notice('Error expanding canvas manually');
		}
	}
	
	getAllNodesWithDepth(centerFile: TFile, depth: number): Array<{file: TFile, level: number, isBacklink: boolean}> {
		const visited = new Set<string>();
		const nodes: Array<{file: TFile, level: number, isBacklink: boolean}> = [];
		
		// Add center node
		nodes.push({file: centerFile, level: 0, isBacklink: false});
		visited.add(centerFile.path);
		
		// Explore backlinks and forward links up to specified depth
		this.exploreLinks(centerFile, depth, 1, visited, nodes, true); // Backlinks
		this.exploreLinks(centerFile, depth, 1, visited, nodes, false); // Forward links
		
		return nodes;
	}
	
	private exploreAllConnections(
		file: TFile,
		maxDepth: number,
		currentDepth: number,
		visited: Set<string>,
		nodes: Array<{file: TFile, level: number, isBacklink: boolean}>,
		connections: Map<string, Set<string>>
	) {
		if (currentDepth > maxDepth) return;
		
		// Get both forward links and backlinks for this file
		const forwardLinks = this.getForwardLinks(file);
		const backlinks = this.getBacklinks(file);
		
		// Initialize connections for this file if not exists
		if (!connections.has(file.path)) {
			connections.set(file.path, new Set<string>());
		}
		
		// Process forward links (file -> other files)
		for (const linkedFile of forwardLinks) {
			// Add connection
			connections.get(file.path)!.add(linkedFile.path);
			
			// Add node if not visited
			if (!visited.has(linkedFile.path)) {
				visited.add(linkedFile.path);
				nodes.push({file: linkedFile, level: currentDepth, isBacklink: false});
				connections.set(linkedFile.path, new Set<string>());
				
				// Recursively explore deeper levels
				this.exploreAllConnections(linkedFile, maxDepth, currentDepth + 1, visited, nodes, connections);
			}
		}
		
		// Process backlinks (other files -> file)
		for (const linkedFile of backlinks) {
			// Add connection (reverse direction)
			if (!connections.has(linkedFile.path)) {
				connections.set(linkedFile.path, new Set<string>());
			}
			connections.get(linkedFile.path)!.add(file.path);
			
			// Add node if not visited
			if (!visited.has(linkedFile.path)) {
				visited.add(linkedFile.path);
				nodes.push({file: linkedFile, level: currentDepth, isBacklink: true});
				
				// Recursively explore deeper levels
				this.exploreAllConnections(linkedFile, maxDepth, currentDepth + 1, visited, nodes, connections);
			}
		}
	}

	private exploreLinks(
		file: TFile, 
		maxDepth: number, 
		currentDepth: number, 
		visited: Set<string>, 
		nodes: Array<{file: TFile, level: number, isBacklink: boolean}>, 
		isBacklink: boolean
	) {
		if (currentDepth > maxDepth) return;
		
		const links = isBacklink ? this.getBacklinks(file) : this.getForwardLinks(file);
		
		for (const linkedFile of links) {
			if (!visited.has(linkedFile.path)) {
				visited.add(linkedFile.path);
				nodes.push({file: linkedFile, level: currentDepth, isBacklink: isBacklink});
				
				// Recursively explore deeper levels
				this.exploreLinks(linkedFile, maxDepth, currentDepth + 1, visited, nodes, isBacklink);
			}
		}
	}

	async generateCanvasForFile(file: TFile) {
		try {
			// Create a new canvas file
			const canvasFileName = `${file.basename}_canvas`;
			// Normalize path to avoid leading or double slashes
			const parentPath = file.parent?.path ?? '';
			const normalizedDir = parentPath.replace(/\\+/g, '/').replace(/^\/+|\/+$|(^\.$)/g, '');
			const canvasPath = normalizedDir ? `${normalizedDir}/${canvasFileName}.canvas` : `${canvasFileName}.canvas`;
			
			// Check if canvas already exists
			const existingCanvas = this.app.vault.getAbstractFileByPath(canvasPath);
			if (existingCanvas) {
				if (this.settings.autoOpenCanvas) {
					new Notice(`Canvas already exists: ${canvasFileName}.canvas - Opening in new tab`);
					// Open the existing canvas in a new tab
					await this.app.workspace.openLinkText(canvasPath, '', false);
				} else {
					new Notice(`Canvas already exists: ${canvasFileName}.canvas`);
				}
				return;
			}

			// Create canvas content
			const canvasContent = this.createCanvasContent(file);
			
			// Create the canvas file
			await this.app.vault.create(canvasPath, canvasContent);
			
			// Open the new canvas if setting is enabled
			if (this.settings.autoOpenCanvas) {
				await this.app.workspace.openLinkText(canvasPath, '', false);
			}
			
			new Notice(`Canvas generated: ${canvasFileName}.canvas`);
		} catch (error) {
			console.error('Error generating canvas:', error);
			new Notice('Error generating canvas');
		}
	}

	private setupAutomaticExpansion() {
		// Add keyboard shortcuts for quick expansion
		this.addCommand({
			id: 'expand-canvas-left',
			name: 'Expand Canvas Left',
			callback: () => {
				this.expandCanvasInDirection('left');
			}
		});

		this.addCommand({
			id: 'expand-canvas-right',
			name: 'Expand Canvas Right',
			callback: () => {
				this.expandCanvasInDirection('right');
			}
		});

		// Add mousedown listener for automatic expansion when clicking on canvas nodes
		this.registerDomEvent(document, 'mousedown', (evt: MouseEvent) => {
			if (!this.settings.autoExpandCanvas) return;
			
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf || !activeLeaf.view) return;
			
			const activeFile = (activeLeaf.view as any).file;
			if (!activeFile || !activeFile.path.endsWith('.canvas')) return;
			
			// Check if we clicked on a canvas node
			const clickedElement = evt.target as HTMLElement;
			
			// Look for canvas node elements more specifically
			const canvasNode = clickedElement.closest('[data-node-id]') || 
							  clickedElement.closest('.canvas-node') ||
							  clickedElement.closest('.canvas-node-content') ||
							  clickedElement.closest('.canvas-file-node') ||
							  clickedElement.closest('.canvas-file-node-content');
			
			if (canvasNode) {
				console.log('Canvas node clicked, checking position...');
				
				// Prevent the default canvas behavior that might trigger generation
				evt.preventDefault();
				evt.stopPropagation();
				
				// Debug: Show available elements in the container
				console.log('Available elements in container:', activeLeaf.view.containerEl.querySelectorAll('*').length);
				console.log('Container classes:', activeLeaf.view.containerEl.className);
				
				// Get the node's position relative to the canvas center
				const canvasElement = activeLeaf.view.containerEl.querySelector('.canvas-view') ||
									activeLeaf.view.containerEl.querySelector('.canvas') ||
									activeLeaf.view.containerEl.querySelector('[data-type="canvas"]') ||
									activeLeaf.view.containerEl.querySelector('.workspace-leaf-content') ||
									activeLeaf.view.containerEl;
				
				if (!canvasElement) {
					console.log('Could not find canvas element');
					return;
				}
				
				const canvasRect = canvasElement.getBoundingClientRect();
				const nodeRect = canvasNode.getBoundingClientRect();
				
				// Calculate if the clicked node is to the left or right of the canvas center
				const canvasCenterX = canvasRect.left + canvasRect.width / 2;
				const nodeCenterX = nodeRect.left + nodeRect.width / 2;
				
				console.log(`Canvas center: ${canvasCenterX}, Node center: ${nodeCenterX}`);
				console.log(`Canvas rect:`, canvasRect);
				console.log(`Node rect:`, nodeRect);
				
				if (nodeCenterX < canvasCenterX - 50) {
					// Node is to the left, expand left
					console.log('Clicked on left node, expanding left');
					// Use setTimeout to prevent conflicts with other handlers
					setTimeout(() => {
						console.log('Calling expandCanvasInDirection left');
						this.expandCanvasInDirection('left');
					}, 100);
				} else if (nodeCenterX > canvasCenterX + 50) {
					// Node is to the right, expand right
					console.log('Clicked on right node, expanding right');
					// Use setTimeout to prevent conflicts with other handlers
					setTimeout(() => {
						console.log('Calling expandCanvasInDirection right');
						this.expandCanvasInDirection('right');
					}, 100);
				} else {
					console.log('Node is in center area, no expansion needed');
				}
				
				// Return false to prevent further event handling
				return false;
			}
		});
	}

	private async expandCanvasInDirection(direction: 'left' | 'right') {
		console.log(`expandCanvasInDirection called with direction: ${direction}`);
		try {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf || !activeLeaf.view) {
				console.log('No active leaf or view');
				return;
			}
			
			const activeFile = (activeLeaf.view as any).file;
			if (!activeFile || !activeFile.path.endsWith('.canvas')) {
				console.log('Active file is not a canvas');
				return;
			}

			const canvasFile = activeFile;
			console.log(`Canvas file: ${canvasFile.path}`);
			
			const canvasName = canvasFile.basename;
			const originalNoteName = canvasName.replace('_canvas', '');
			console.log(`Original note name: ${originalNoteName}`);
			
			const originalNote = this.app.vault.getAbstractFileByPath(`${originalNoteName}.md`);
			if (!originalNote || !(originalNote instanceof TFile)) {
				console.log('Could not find original note');
				return;
			}

			// Read current canvas content
			const currentContent = await this.app.vault.read(canvasFile);
			let canvasData;
			try {
				canvasData = JSON.parse(currentContent);
				console.log(`Canvas has ${canvasData.nodes.length} nodes`);
			} catch (e) {
				console.log('Failed to parse canvas data:', e);
				return;
			}

			// Get all existing file paths in the canvas
			const existingPaths = new Set(canvasData.nodes.map((n: any) => n.file));
			console.log(`Existing paths:`, Array.from(existingPaths));
			let expanded = false;

			// Find nodes that can expand in the specified direction
			for (const node of canvasData.nodes) {
				const nodeNote = this.app.vault.getAbstractFileByPath(node.file);
				if (!nodeNote || !(nodeNote instanceof TFile)) {
					console.log(`Could not find note for node: ${node.file}`);
					continue;
				}

				console.log(`Checking node: ${nodeNote.basename}`);

				if (direction === 'right') {
					// Get forward links from this node
					const forwardLinks = this.getForwardLinks(nodeNote);
					console.log(`Forward links from ${nodeNote.basename}:`, forwardLinks.map(f => f.basename));
					const newForwardLinks = forwardLinks.filter(link => !existingPaths.has(link.path));
					console.log(`New forward links:`, newForwardLinks.map(f => f.basename));
					
					if (newForwardLinks.length > 0) {
						console.log(`Expanding right from ${nodeNote.basename} with ${newForwardLinks.length} new links`);
						await this.expandCanvas(canvasFile, nodeNote, 'right');
						expanded = true;
						// Update existing paths after expansion
						const updatedContent = await this.app.vault.read(canvasFile);
						const updatedData = JSON.parse(updatedContent);
						updatedData.nodes.forEach((n: any) => existingPaths.add(n.file));
					}
				} else {
					// Get backlinks to this node
					const backlinks = this.getBacklinks(nodeNote);
					console.log(`Backlinks to ${nodeNote.basename}:`, backlinks.map(f => f.basename));
					const newBacklinks = backlinks.filter(link => !existingPaths.has(link.path));
					console.log(`New backlinks:`, newBacklinks.map(f => f.basename));
					
					if (newBacklinks.length > 0) {
						console.log(`Expanding left from ${nodeNote.basename} with ${newBacklinks.length} new links`);
						await this.expandCanvas(canvasFile, nodeNote, 'left');
						expanded = true;
						// Update existing paths after expansion
						const updatedContent = await this.app.vault.read(canvasFile);
						const updatedData = JSON.parse(updatedContent);
						updatedData.nodes.forEach((n: any) => existingPaths.add(n.file));
					}
				}
			}

			if (expanded) {
				console.log(`Canvas expanded ${direction}!`);
				new Notice(`Canvas expanded ${direction}!`);
			} else {
				console.log(`No expansion needed for ${direction}`);
			}

		} catch (error) {
			console.error('Error expanding canvas:', error);
		}
	}
}

class CanvasAutoGenSettingTab extends PluginSettingTab {
	plugin: CanvasAutoGenPlugin;

	constructor(app: App, plugin: CanvasAutoGenPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Canvas Auto-Generation Settings'});

		new Setting(containerEl)
			.setName('Auto-generate on file open')
			.setDesc('Automatically generate a canvas when opening a markdown file')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoGenerateOnOpen)
				.onChange(async (value) => {
					this.plugin.settings.autoGenerateOnOpen = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-open canvas')
			.setDesc('Automatically open canvas after creation (disable to create silently)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoOpenCanvas)
				.onChange(async (value) => {
					this.plugin.settings.autoOpenCanvas = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Canvas Width')
			.setDesc('Default width for generated canvases')
			.addSlider(slider => slider
				.setLimits(400, 1200, 50)
				.setValue(this.plugin.settings.canvasWidth)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.canvasWidth = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Canvas Height')
			.setDesc('Default height for generated canvases')
			.addSlider(slider => slider
				.setLimits(300, 1000, 50)
				.setValue(this.plugin.settings.canvasHeight)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.canvasHeight = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Link Depth')
			.setDesc('Number of levels of links to include in the canvas (1 = immediate links only, 2 = links of links, etc.)')
			.addSlider(slider => slider
				.setLimits(1, 5, 1)
				.setValue(this.plugin.settings.linkDepth)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.linkDepth = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-expand canvas')
			.setDesc('Automatically expand the canvas when you click on nodes near the edges (click left nodes to expand left, right nodes to expand right)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoExpandCanvas)
				.onChange(async (value) => {
					this.plugin.settings.autoExpandCanvas = value;
					await this.plugin.saveSettings();
				}));
	}
}
