import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { NodeState } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json()); // Middleware to parse JSON bodies
  node.use(bodyParser.json()); // Middleware to parse JSON bodies, bodyParser is deprecated in favor of express.json()

  let currentNodeState: NodeState = {killed: false, x: null, decided: null, k: null}; // Holds the current state of the node
  let proposals: Map<number, Value[]> = new Map(); // Stores proposals received from other nodes
  let votes: Map<number, Value[]> = new Map(); // Stores votes received from other nodes

  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty"); // Respond with 500 if node is faulty
    }
    else {
      res.status(200).send("live"); // Respond with 200 and "live" if node is not faulty
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body; // Extracts message details from the request body
    if (!isFaulty && !currentNodeState.killed) { // Process messages only if node is not faulty or killed
      if (messageType == "propose") {
        // Handles proposal messages
        if (!proposals.has(k)) {
          proposals.set(k, []); // Initialize proposals for round k if not already done
        }
        proposals.get(k)!.push(x); // Add proposal to the list for round k
        let proposal = proposals.get(k)!;

        // Check if enough proposals have been received to make a decision
        if (proposal.length >= (N - F)) {
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          // Determine consensus based on majority, else "?" if no majority
          if (count0 > (N / 2)) {
            x = 0;
          }
          else if (count1 > (N / 2)) {
            x = 1;
          }
          else {
            x = "?";
          }
          // Broadcast decision to all nodes
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ k: k, x: x, messageType: "vote" }),
            });
          }
        }
      }
      else if (messageType == "vote") {
        // Handles vote messages
        if (!votes.has(k)) {
          votes.set(k, []); // Initialize votes for round k if not already done
        }
        votes.get(k)!.push(x); // Add vote to the list for round k
        let vote = votes.get(k)!;

        // Check if enough votes have been received to finalize decision
        if (vote.length >= (N - F)) {
          console.log("vote", vote,"node :",nodeId,"k :",k);
          // Process votes to update node state
          let count0 = vote.filter((el) => el == 0).length;
          let count1 = vote.filter((el) => el == 1).length;

          // Determine node state based on vote majority or random selection if tied
          if (count0 >= F + 1) {
            currentNodeState.x = 0;
            currentNodeState.decided = true;
          }
          else if (count1 >= F + 1) {
            currentNodeState.x = 1;
            currentNodeState.decided = true;
          }
          else {
            // If no clear majority, decide based on count or randomly
            if (count0 + count1 > 0 && count0 > count1) {
              currentNodeState.x = 0;
            }
            else if (count0 + count1 > 0 && count0 < count1) {
              currentNodeState.x = 1;
            }
            else {
              currentNodeState.x = Math.random() > 0.5 ? 0 : 1; // Random decision
            }
            currentNodeState.k = k + 1; // Prepare for next round

            // Broadcast new proposal based on updated state
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({k: currentNodeState.k, x: currentNodeState.x, messageType: "propose"}),
              });
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed."); // Acknowledge message processing
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5); // Wait until all nodes are ready
    }
    // Initialize the consensus algorithm based on node state
    if (!isFaulty) {
      currentNodeState.k = 1;
      currentNodeState.x = initialValue;
      currentNodeState.decided = false;
      // Broadcast initial proposal to all nodes
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" }),
        });
      }
    }
    else { // Reset state for faulty nodes
      currentNodeState.decided = null;
      currentNodeState.x = null;
      currentNodeState.k = null;
    }
    res.status(200).send("Consensus algorithm started."); // Signal that consensus algorithm has started
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentNodeState.killed = true; // Mark node as killed
    res.status(200).send("killed"); // Acknowledge stopping the node
  });;

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).send({
      killed: currentNodeState.killed,
      x: currentNodeState.x,
      decided: currentNodeState.decided,
      k: currentNodeState.k,
    });
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}` // Log that the node is listening on its port
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}