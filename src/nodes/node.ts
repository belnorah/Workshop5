import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";

// Définition de l'état du nœud
type NodeState = {
  killed: boolean;
  x: 0 | 1 | "?" | null;
  decided: boolean | null;
  k: number | null;
};

type Message = {
  from: number;
  round: number;
  value: Value;
};

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  let killed = false;

  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let receivedMessages: Message[] = [];
  let interval: NodeJS.Timeout | null = null;

  app.get("/status", (req, res) => {
    if (isFaulty) return res.status(500).send("faulty");
    return res.status(200).send("live");
  });

  app.get("/getState", (req, res) => {
    if (isFaulty) {
      return res.json({ killed, x: null, decided: null, k: null });
    }
    return res.json(state);
  });

  app.post("/message", (req, res) => {
    if (killed || isFaulty) return res.sendStatus(200);
    const msg: Message = req.body;
    if (msg.round === state.k) receivedMessages.push(msg);
    return res.sendStatus(200);
  });

  app.get("/stop", (req, res) => {
    killed = true;
    state.killed = true;
    if (interval) clearInterval(interval);
    return res.sendStatus(200);
  });

  app.get("/start", async (req, res) => {
    if (killed || isFaulty) return res.sendStatus(200);

    const runConsensus = async () => {
      if (!nodesAreReady()) return;

      if (N === 1) {
        state.decided = true;
        return;
      }

      for (let i = 0; i < N; i++) {
        if (i === nodeId) continue;
        try {
          await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: nodeId, round: state.k, value: state.x }),
          });
        } catch {}
      }

      setTimeout(() => {
        const msgs = receivedMessages.filter(m => m.round === state.k);
        receivedMessages = [];

        const count: Record<string, number> = {};
        for (const msg of msgs) {
          if (msg.value !== null && msg.value !== "?") {
            count[msg.value] = (count[msg.value] || 0) + 1;
          }
        }

        if (state.x !== null) {
          count[state.x] = (count[state.x] || 0) + 1;
        }

        const honestMajority = N - F;
        let decidedThisRound = false;

        if (count["0"] >= honestMajority) {
          state.x = 0;
          state.decided = true;
          decidedThisRound = true;
        } else if (count["1"] >= honestMajority) {
          state.x = 1;
          state.decided = true;
          decidedThisRound = true;
        } else {
          state.x = Math.random() < 0.5 ? 0 : 1;
        }

        if (!decidedThisRound && state.k !== null && state.k > 10) {
          state.decided = false;
        }

        if (state.k !== null) state.k++;
      }, 200);
    };

    interval = setInterval(runConsensus, 500);
    return res.sendStatus(200);
  });

  const server = app.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}