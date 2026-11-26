import * as THREE from 'three';
import { CARD_H, CARD_T, CARD_W } from './layout';

/**
 * Shared immutable Three.js geometries and materials reused across board meshes
 * to avoid per-card GPU buffer allocations (docs/audits/06-architecture-improvements.md §4.2).
 */
export const DECK_CARD_GEO = new THREE.BoxGeometry(CARD_W, 1, CARD_H);
export const OPPONENT_CARD_GEO = new THREE.BoxGeometry(CARD_W * 0.72, CARD_T, CARD_H * 0.72);
export const OPPONENT_EDGE_MAT = new THREE.MeshLambertMaterial({ color: '#1b2636' });
