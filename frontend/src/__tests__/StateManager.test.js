import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateManager, createInitialState } from '../core/StateManager.js';

describe('StateManager', () => {
    let manager;

    beforeEach(() => {
        manager = new StateManager({
            count: 0,
            user: { name: 'Alice', age: 30 },
            items: [1, 2, 3]
        });
    });

    describe('Basic State Access', () => {
        it('should return current state', () => {
            expect(manager.state).toEqual({
                count: 0,
                user: { name: 'Alice', age: 30 },
                items: [1, 2, 3]
            });
        });

        it('should get value by path', () => {
            expect(manager.get('count')).toBe(0);
            expect(manager.get('user.name')).toBe('Alice');
            expect(manager.get('user.age')).toBe(30);
        });

        it('should return undefined for non-existent path', () => {
            expect(manager.get('foo.bar.baz')).toBeUndefined();
        });

        it('should freeze state to prevent direct mutation', () => {
            expect(() => {
                manager.state.count = 10;
            }).toThrow();
        });
    });

    describe('State Updates', () => {
        it('should update state immutably', () => {
            const oldState = manager.state;

            manager.update(draft => {
                draft.count = 42;
            });

            expect(manager.state.count).toBe(42);
            expect(oldState.count).toBe(0); // Old state unchanged
            expect(oldState).not.toBe(manager.state); // Different reference
        });

        it('should update nested properties', () => {
            manager.update(draft => {
                draft.user.age = 31;
            });

            expect(manager.get('user.age')).toBe(31);
        });

        it('should update arrays', () => {
            manager.update(draft => {
                draft.items.push(4);
            });

            expect(manager.state.items).toEqual([1, 2, 3, 4]);
        });

        it('should set value by path', () => {
            manager.set('count', 100);
            expect(manager.get('count')).toBe(100);

            manager.set('user.name', 'Bob');
            expect(manager.get('user.name')).toBe('Bob');
        });
    });

    describe('Observers', () => {
        it('should notify global listeners on state change', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            manager.update(draft => {
                draft.count = 5;
            });

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ count: 5 }),
                expect.objectContaining({ count: 0 })
            );
        });

        it('should notify path-specific listeners', () => {
            const countListener = vi.fn();
            const nameListener = vi.fn();

            manager.subscribeTo('count', countListener);
            manager.subscribeTo('user.name', nameListener);

            manager.update(draft => {
                draft.count = 10;
            });

            expect(countListener).toHaveBeenCalledWith(10, 0);
            expect(nameListener).not.toHaveBeenCalled(); // user.name didn't change
        });

        it('should not notify if value unchanged', () => {
            const listener = vi.fn();
            manager.subscribeTo('count', listener);

            manager.update(draft => {
                draft.user.name = 'Bob'; // Changed user.name, not count
            });

            expect(listener).not.toHaveBeenCalled();
        });

        it('should allow unsubscribe', () => {
            const listener = vi.fn();
            const unsubscribe = manager.subscribe(listener);

            manager.update(draft => { draft.count = 1; });
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();

            manager.update(draft => { draft.count = 2; });
            expect(listener).toHaveBeenCalledTimes(1); // Not called again
        });

        it('should handle errors in listeners gracefully', () => {
            const badListener = vi.fn(() => {
                throw new Error('Listener error');
            });
            const goodListener = vi.fn();

            manager.subscribe(badListener);
            manager.subscribe(goodListener);

            // Should not throw
            expect(() => {
                manager.update(draft => { draft.count = 5; });
            }).not.toThrow();

            expect(goodListener).toHaveBeenCalled();
        });
    });

    describe('Undo/Redo', () => {
        it('should undo state changes', () => {
            manager.update(draft => { draft.count = 1; });
            manager.update(draft => { draft.count = 2; });
            manager.update(draft => { draft.count = 3; });

            expect(manager.state.count).toBe(3);

            manager.undo();
            expect(manager.state.count).toBe(2);

            manager.undo();
            expect(manager.state.count).toBe(1);
        });

        it('should redo undone changes', () => {
            manager.update(draft => { draft.count = 1; });
            manager.update(draft => { draft.count = 2; });

            manager.undo();
            expect(manager.state.count).toBe(1);

            manager.redo();
            expect(manager.state.count).toBe(2);
        });

        it('should clear redo stack on new action', () => {
            manager.update(draft => { draft.count = 1; });
            manager.update(draft => { draft.count = 2; });

            manager.undo();
            expect(manager.getHistoryInfo().canRedo).toBe(true);

            manager.update(draft => { draft.count = 99; });
            expect(manager.getHistoryInfo().canRedo).toBe(false);
        });

        it('should return false when nothing to undo/redo', () => {
            expect(manager.undo()).toBe(false);
            expect(manager.redo()).toBe(false);
        });

        it('should provide history info', () => {
            const info1 = manager.getHistoryInfo();
            expect(info1.undoCount).toBe(0);
            expect(info1.canUndo).toBe(false);

            manager.update(draft => { draft.count = 1; });

            const info2 = manager.getHistoryInfo();
            expect(info2.undoCount).toBe(1);
            expect(info2.canUndo).toBe(true);
        });

        it('should skip history when requested', () => {
            manager.update(draft => { draft.count = 1; }, { skipHistory: true });

            expect(manager.getHistoryInfo().undoCount).toBe(0);
            expect(manager.undo()).toBe(false);
        });

        it('should notify listeners on undo/redo', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            manager.update(draft => { draft.count = 5; });
            listener.mockClear();

            manager.undo();
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should clear history', () => {
            manager.update(draft => { draft.count = 1; });
            manager.update(draft => { draft.count = 2; });

            expect(manager.getHistoryInfo().undoCount).toBe(2);

            manager.clearHistory();

            expect(manager.getHistoryInfo().undoCount).toBe(0);
            expect(manager.undo()).toBe(false);
        });
    });

    describe('Replace State', () => {
        it('should replace entire state', () => {
            manager.replaceState({
                count: 999,
                user: { name: 'Charlie', age: 40 },
                items: [10, 20]
            });

            expect(manager.state.count).toBe(999);
            expect(manager.get('user.name')).toBe('Charlie');
        });

        it('should clear history by default when replacing', () => {
            manager.update(draft => { draft.count = 5; });
            expect(manager.getHistoryInfo().undoCount).toBe(1);

            manager.replaceState({ count: 0 });

            expect(manager.getHistoryInfo().undoCount).toBe(0);
        });

        it('should preserve history if requested', () => {
            manager.update(draft => { draft.count = 5; });

            manager.replaceState({ count: 10 }, false);

            expect(manager.getHistoryInfo().undoCount).toBe(1);
        });

        it('should notify listeners when replacing', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            manager.replaceState({ count: 100 });

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('Deep Cloning', () => {
        it('should handle nested objects', () => {
            const complex = new StateManager({
                a: {
                    b: {
                        c: { value: 1 }
                    }
                }
            });

            complex.update(draft => {
                draft.a.b.c.value = 2;
            });

            expect(complex.get('a.b.c.value')).toBe(2);
        });

        it('should handle arrays of objects', () => {
            const arrayState = new StateManager({
                items: [
                    { id: 1, name: 'First' },
                    { id: 2, name: 'Second' }
                ]
            });

            arrayState.update(draft => {
                draft.items[0].name = 'Updated';
            });

            expect(arrayState.state.items[0].name).toBe('Updated');
        });

        it('should preserve Date objects', () => {
            const date = new Date('2025-01-01');
            const dateState = new StateManager({ timestamp: date });

            dateState.update(draft => {
                draft.count = 1;
            });

            expect(dateState.state.timestamp).toBeInstanceOf(Date);
            expect(dateState.state.timestamp.getTime()).toBe(date.getTime());
        });

        it('should not clone binary data', () => {
            const buffer = new ArrayBuffer(8);
            const binaryState = new StateManager({ buffer });

            binaryState.update(draft => {
                draft.count = 1;
            });

            // Same reference (not cloned)
            expect(binaryState.state.buffer).toBe(buffer);
        });
    });
});

describe('createInitialState', () => {
    it('should create valid initial state structure', () => {
        const state = createInitialState();

        expect(state).toHaveProperty('project');
        expect(state.project).toHaveProperty('version');
        expect(state.project.version).toBe('1.0.0');
        expect(state.project).toHaveProperty('tracks');
        expect(state).toHaveProperty('playback');
        expect(state).toHaveProperty('ui');
        expect(state).toHaveProperty('audio');
    });

    it('should have default tracks', () => {
        const state = createInitialState();

        expect(state.project.tracks).toHaveLength(2);
        expect(state.project.tracks[0].type).toBe('audio');
        expect(state.project.tracks[1].type).toBe('led');
    });
});
