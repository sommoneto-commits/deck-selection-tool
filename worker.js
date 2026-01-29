/**
 * Magic Swiss Tournament Monte Carlo Simulator
 * Web Worker for Simulation
 */

// ============================================================================
// Pseudo-Random Number Generator (Mulberry32)
// ============================================================================

class PRNG {
    constructor(seed = null) {
        this.seed = seed !== null ? seed : Math.floor(Math.random() * 2147483647);
        this.state = this.seed;
    }

    // Returns float in [0, 1)
    random() {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    // Returns integer in [min, max]
    randInt(min, max) {
        return Math.floor(this.random() * (max - min + 1)) + min;
    }

    // Shuffle array in place
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}

// ============================================================================
// Player Class
// ============================================================================

class Player {
    constructor(id, deckIndex, deck) {
        this.id = id;
        this.deckIndex = deckIndex;
        this.deck = deck;
        this.wins = 0;
        this.losses = 0;
        this.draws = 0;
        this.points = 0;
        this.opponents = []; // List of opponent IDs
        this.matchWins = 0;  // Total match wins for MW%
        this.matchLosses = 0;
        this.matchDraws = 0;
    }

    get record() {
        return `${this.wins}-${this.draws}-${this.losses}`;
    }

    reset() {
        this.wins = 0;
        this.losses = 0;
        this.draws = 0;
        this.points = 0;
        this.opponents = [];
        this.matchWins = 0;
        this.matchLosses = 0;
        this.matchDraws = 0;
    }
}

// ============================================================================
// Tournament Simulator
// ============================================================================

class TournamentSimulator {
    constructor(config) {
        this.metagame = config.metagame;
        this.matchups = config.matchups;
        this.numPlayers = config.numPlayers;
        this.numRounds = config.numRounds;
        this.numTrials = config.numTrials;
        this.cutTop8 = config.cutTop8;
        this.thresholds = config.thresholds || [9, 10, 11, 12];
        this.rng = new PRNG(config.seed);

        // Build cumulative distribution for deck sampling
        this.buildMetaDistribution();

        // Initialize stats
        this.initStats();

        // Create player pool (reused across trials)
        this.players = [];
        for (let i = 0; i < this.numPlayers; i++) {
            this.players.push(new Player(i, 0, null));
        }
    }

    buildMetaDistribution() {
        this.deckNames = this.metagame.map(d => d.archetype);
        this.deckDrawPcts = this.metagame.map(d => d.draw_pct);
        this.deckSkillAdjs = this.metagame.map(d => d.skill_adj);

        // Build matchup matrix as 2D array for fast access
        this.matchupMatrix = [];
        for (let i = 0; i < this.deckNames.length; i++) {
            this.matchupMatrix[i] = [];
            for (let j = 0; j < this.deckNames.length; j++) {
                const deckI = this.deckNames[i];
                const deckJ = this.deckNames[j];
                this.matchupMatrix[i][j] = this.matchups[deckI][deckJ];
            }
        }

        // Build cumulative distribution
        this.metaCDF = [];
        let cumulative = 0;
        for (const deck of this.metagame) {
            cumulative += deck.meta_pct;
            this.metaCDF.push(cumulative);
        }
    }

    initStats() {
        this.stats = {};
        for (let i = 0; i < this.deckNames.length; i++) {
            const name = this.deckNames[i];
            this.stats[name] = {
                count: 0,           // Times this deck appeared in field
                top8: 0,            // Times made top 8
                wins: 0,            // Times won tournament
                totalPoints: 0,     // Sum of Swiss points
                matchWins: 0,       // Total match wins
                matchLosses: 0,     // Total match losses
                matchDraws: 0,      // Total match draws
                thresholds: {},     // Threshold counts
                records: {}         // Record distribution
            };
            for (const t of this.thresholds) {
                this.stats[name].thresholds[t] = 0;
            }
        }
    }

    sampleDeck() {
        const r = this.rng.random();
        for (let i = 0; i < this.metaCDF.length; i++) {
            if (r < this.metaCDF[i]) {
                return i;
            }
        }
        return this.metaCDF.length - 1;
    }

    generateField() {
        for (let i = 0; i < this.numPlayers; i++) {
            const deckIndex = this.sampleDeck();
            this.players[i].deckIndex = deckIndex;
            this.players[i].deck = this.deckNames[deckIndex];
            this.players[i].reset();
        }
    }

    resolveMatch(p1, p2) {
        const d1 = p1.deckIndex;
        const d2 = p2.deckIndex;

        // Calculate draw probability
        const drawProb = Math.min(0.5, Math.max(0, (this.deckDrawPcts[d1] + this.deckDrawPcts[d2]) / 2));

        // Check for draw
        if (this.rng.random() < drawProb) {
            p1.draws++;
            p2.draws++;
            p1.points += 1;
            p2.points += 1;
            p1.matchDraws++;
            p2.matchDraws++;
            return 'draw';
        }

        // Calculate win probability with skill adjustment
        let baseWinProb = this.matchupMatrix[d1][d2];

        // Apply skill adjustment (logistic combination)
        const skillDiff = this.deckSkillAdjs[d1] - this.deckSkillAdjs[d2];
        // Convert to odds, apply adjustment, convert back
        const logit = Math.log(baseWinProb / (1 - baseWinProb)) + skillDiff * 4; // 4 is scaling factor
        const adjustedWinProb = 1 / (1 + Math.exp(-logit));
        const finalWinProb = Math.min(0.99, Math.max(0.01, adjustedWinProb));

        // Resolve winner
        if (this.rng.random() < finalWinProb) {
            p1.wins++;
            p2.losses++;
            p1.points += 3;
            p1.matchWins++;
            p2.matchLosses++;
            return 'p1';
        } else {
            p2.wins++;
            p1.losses++;
            p2.points += 3;
            p2.matchWins++;
            p1.matchLosses++;
            return 'p2';
        }
    }

    // Resolve match without draws (for Top 8)
    resolveMatchNoDraw(p1, p2) {
        const d1 = p1.deckIndex;
        const d2 = p2.deckIndex;

        let baseWinProb = this.matchupMatrix[d1][d2];

        // Apply skill adjustment
        const skillDiff = this.deckSkillAdjs[d1] - this.deckSkillAdjs[d2];
        const logit = Math.log(baseWinProb / (1 - baseWinProb)) + skillDiff * 4;
        const adjustedWinProb = 1 / (1 + Math.exp(-logit));
        const finalWinProb = Math.min(0.99, Math.max(0.01, adjustedWinProb));

        return this.rng.random() < finalWinProb ? p1 : p2;
    }

    swissPairing() {
        // Group players by points
        const groups = new Map();
        for (const player of this.players) {
            if (!groups.has(player.points)) {
                groups.set(player.points, []);
            }
            groups.get(player.points).push(player);
        }

        // Sort point groups descending
        const sortedPoints = [...groups.keys()].sort((a, b) => b - a);

        const pairs = [];
        let floatDown = null;

        for (const points of sortedPoints) {
            let group = groups.get(points);
            this.rng.shuffle(group);

            // Add float from previous group
            if (floatDown !== null) {
                group.unshift(floatDown);
                floatDown = null;
            }

            // Pair players in group
            while (group.length >= 2) {
                const p1 = group.shift();
                const p2 = group.shift();
                pairs.push([p1, p2]);
                p1.opponents.push(p2.id);
                p2.opponents.push(p1.id);
            }

            // Handle odd player (float down)
            if (group.length === 1) {
                floatDown = group[0];
            }
        }

        // If we still have a float, give them a bye
        if (floatDown !== null) {
            floatDown.wins++;
            floatDown.points += 3;
            floatDown.matchWins++;
        }

        return pairs;
    }

    calculateTiebreakers() {
        // TB1: Opponent Match Win Percentage (sum of opponents' points)
        for (const player of this.players) {
            let oppPoints = 0;
            for (const oppId of player.opponents) {
                oppPoints += this.players[oppId].points;
            }
            player.tiebreaker1 = oppPoints;
            player.tiebreaker2 = this.rng.random(); // Random for remaining ties
        }
    }

    getStandings() {
        // Calculate tiebreakers
        this.calculateTiebreakers();

        // Sort by points, then TB1, then TB2
        const sorted = [...this.players].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.tiebreaker1 !== a.tiebreaker1) return b.tiebreaker1 - a.tiebreaker1;
            return b.tiebreaker2 - a.tiebreaker2;
        });

        return sorted;
    }

    simulateTop8(standings) {
        const top8 = standings.slice(0, 8);

        // Bracket: 1v8, 4v5, 2v7, 3v6
        const bracket = [
            [top8[0], top8[7]], // 1 vs 8
            [top8[3], top8[4]], // 4 vs 5
            [top8[1], top8[6]], // 2 vs 7
            [top8[2], top8[5]]  // 3 vs 6
        ];

        // Quarterfinals
        const semis = [];
        for (const [p1, p2] of bracket) {
            const winner = this.resolveMatchNoDraw(p1, p2);
            semis.push(winner);
        }

        // Semifinals
        const finals = [];
        finals.push(this.resolveMatchNoDraw(semis[0], semis[1]));
        finals.push(this.resolveMatchNoDraw(semis[2], semis[3]));

        // Finals
        const champion = this.resolveMatchNoDraw(finals[0], finals[1]);

        return champion;
    }

    runTrial() {
        // Generate field
        this.generateField();

        // Run Swiss rounds
        for (let round = 0; round < this.numRounds; round++) {
            const pairs = this.swissPairing();
            for (const [p1, p2] of pairs) {
                this.resolveMatch(p1, p2);
            }
        }

        // Get final standings
        const standings = this.getStandings();

        // Update stats
        const top8Players = this.cutTop8 ? standings.slice(0, 8) : [];
        let champion = null;

        if (this.cutTop8 && standings.length >= 8) {
            champion = this.simulateTop8(standings);
        }

        // Record stats for all players
        for (const player of this.players) {
            const deckStats = this.stats[player.deck];
            deckStats.count++;
            deckStats.totalPoints += player.points;
            deckStats.matchWins += player.matchWins;
            deckStats.matchLosses += player.matchLosses;
            deckStats.matchDraws += player.matchDraws;

            // Check thresholds
            for (const t of this.thresholds) {
                if (player.wins >= t) {
                    deckStats.thresholds[t]++;
                }
            }

            // Record distribution
            const record = player.record;
            deckStats.records[record] = (deckStats.records[record] || 0) + 1;
        }

        // Record Top 8 and wins
        for (const player of top8Players) {
            this.stats[player.deck].top8++;
        }

        if (champion) {
            this.stats[champion.deck].wins++;
        }
    }

    run(progressCallback) {
        const batchSize = Math.max(100, Math.floor(this.numTrials / 100));

        for (let trial = 0; trial < this.numTrials; trial++) {
            this.runTrial();

            // Report progress
            if (trial % batchSize === 0 || trial === this.numTrials - 1) {
                progressCallback(trial + 1, this.numTrials);
            }
        }

        return this.getResults();
    }

    getResults() {
        const decks = [];

        for (const name of this.deckNames) {
            const s = this.stats[name];
            if (s.count === 0) continue;

            const totalMatches = s.matchWins + s.matchLosses + s.matchDraws;

            // Find most common record
            let mostCommonRecord = '';
            let maxRecordCount = 0;
            for (const [record, count] of Object.entries(s.records)) {
                if (count > maxRecordCount) {
                    maxRecordCount = count;
                    mostCommonRecord = record;
                }
            }

            const deckResult = {
                deck: name,
                pWin: s.wins / s.count,
                pTop8: s.top8 / s.count,
                avgPoints: s.totalPoints / s.count,
                expectedMW: totalMatches > 0 ? s.matchWins / totalMatches : 0,
                mostCommonRecord
            };

            // Add threshold stats
            for (const t of this.thresholds) {
                deckResult[`p${t}Wins`] = s.thresholds[t] / s.count;
            }

            decks.push(deckResult);
        }

        // Sort by P(win), then P(top8)
        decks.sort((a, b) => {
            if (b.pWin !== a.pWin) return b.pWin - a.pWin;
            return b.pTop8 - a.pTop8;
        });

        return {
            decks,
            trials: this.numTrials,
            config: {
                numPlayers: this.numPlayers,
                numRounds: this.numRounds,
                cutTop8: this.cutTop8
            },
            thresholds: this.thresholds
        };
    }
}

// ============================================================================
// Worker Message Handler
// ============================================================================

let simulator = null;
let cancelled = false;

self.onmessage = function(e) {
    const { type, config } = e.data;

    switch (type) {
        case 'start':
            cancelled = false;
            try {
                simulator = new TournamentSimulator(config);
                const results = simulator.run((completed, total) => {
                    if (cancelled) {
                        throw new Error('Cancelled');
                    }
                    self.postMessage({
                        type: 'progress',
                        data: { completed, total }
                    });
                });

                self.postMessage({
                    type: 'complete',
                    data: results
                });
            } catch (error) {
                if (error.message !== 'Cancelled') {
                    self.postMessage({
                        type: 'error',
                        data: { message: error.message }
                    });
                }
            }
            break;

        case 'cancel':
            cancelled = true;
            break;
    }
};
