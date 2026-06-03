import React, { useState, useEffect, useRef } from 'react';

function App() {
  // Accounts, mesh states, transactions
  const [accounts, setAccounts] = useState([]);
  const [meshState, setMeshState] = useState({ devices: [], idempotencyCacheSize: 0 });
  const [transactions, setTransactions] = useState([]);
  
  // Demo flow states
  const [activeStep, setActiveStep] = useState(1);
  const [gossipCount, setGossipCount] = useState(0);
  const [lastOutcome, setLastOutcome] = useState(null);
  
  // UI interaction states
  const [toasts, setToasts] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [flashes, setFlashes] = useState({});
  const [newTxIds, setNewTxIds] = useState(new Set());
  const [logs, setLogs] = useState([]);

  // Form states
  const [senderVpa, setSenderVpa] = useState('alice@demo');
  const [receiverVpa, setReceiverVpa] = useState('bob@demo');
  const [amount, setAmount] = useState('500');
  const [pin, setPin] = useState('1234');

  // Loading states
  const [loading, setLoading] = useState({
    inject: false,
    gossip: false,
    flush: false,
    reset: false
  });

  // Refs for tracking changes
  const prevBalancesRef = useRef({});
  const prevTxIdsRef = useRef(new Set());

  // Live ticking clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Log handler
  const addLog = (msg) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  // Toast handler
  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const addToast = (message, type = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  // Poll API endpoints
  const fetchState = async () => {
    try {
      // Mesh State
      const meshRes = await fetch('/api/mesh/state');
      if (meshRes.ok) {
        const meshData = await meshRes.json();
        setMeshState(meshData);
      }

      // Accounts (and calculate balance flashes)
      const accountsRes = await fetch('/api/accounts');
      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        setAccounts(accountsData);

        // Determine flash directions
        const newBalances = {};
        const newFlashes = { ...flashes };
        let hasFlashes = false;
        
        accountsData.forEach((acc) => {
          newBalances[acc.vpa] = acc.balance;
          const prevVal = prevBalancesRef.current[acc.vpa];
          if (prevVal !== undefined && prevVal !== acc.balance) {
            const type = acc.balance > prevVal ? 'credit' : 'debit';
            newFlashes[acc.vpa] = { type, timestamp: Date.now() };
            hasFlashes = true;
          }
        });

        if (hasFlashes) {
          setFlashes(newFlashes);
          setTimeout(() => {
            setFlashes((prev) => {
              const current = { ...prev };
              Object.keys(current).forEach((k) => {
                if (Date.now() - current[k].timestamp >= 1500) {
                  delete current[k];
                }
              });
              return current;
            });
          }, 1500);
        }
        prevBalancesRef.current = newBalances;
      }

      // Transactions (and calculate new row entry animations)
      const txsRes = await fetch('/api/transactions');
      if (txsRes.ok) {
        const txsData = await txsRes.json();
        setTransactions(txsData);

        const currentIds = new Set(txsData.map((t) => t.id));
        const freshlyAdded = [];
        txsData.forEach((t) => {
          if (prevTxIdsRef.current.size > 0 && !prevTxIdsRef.current.has(t.id)) {
            freshlyAdded.push(t.id);
          }
        });

        if (freshlyAdded.length > 0) {
          setNewTxIds((prev) => {
            const updated = new Set(prev);
            freshlyAdded.forEach((id) => updated.add(id));
            return updated;
          });
          setTimeout(() => {
            setNewTxIds((prev) => {
              const updated = new Set(prev);
              freshlyAdded.forEach((id) => updated.delete(id));
              return updated;
            });
          }, 1000);
        }
        prevTxIdsRef.current = currentIds;
      }
    } catch (err) {
      console.error('Failed polling server endpoints:', err);
    }
  };

  // Trigger poll on load and every 3 seconds
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, []);

  // Form submit: Inject payment into Mesh
  const handleInject = async (e) => {
    e.preventDefault();
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }
    if (!pin || pin.length !== 4) {
      addToast('PIN must be exactly 4 digits', 'error');
      return;
    }

    setLoading((prev) => ({ ...prev, inject: true }));
    try {
      const response = await fetch('/api/demo/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderVpa,
          receiverVpa,
          amount: parseFloat(amount),
          pin,
          ttl: 5,
          startDevice: 'phone-alice'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to inject packet into mesh');
      }

      const res = await response.json();
      addLog(`📤 Packet ${res.packetId.substring(0, 8)} encrypted & injected at ${res.injectedAt} (TTL ${res.ttl})`);
      addLog(`   Ciphertext Preview: ${res.ciphertextPreview}`);
      addToast('Payment injected into mesh successfully!', 'success');
      
      // Auto-advance stepper to Step 2
      setActiveStep(2);
      
      setLastOutcome({
        type: 'INJECT',
        status: 'INJECTED',
        packetId: res.packetId,
        injectedAt: res.injectedAt,
        ciphertextPreview: res.ciphertextPreview,
        details: `Sender: ${senderVpa} | Receiver: ${receiverVpa} | Amount: ₹${parseFloat(amount).toFixed(2)}`
      });

      fetchState();
    } catch (err) {
      addToast(err.message, 'error');
      addLog(`❌ Injection failed: ${err.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, inject: false }));
    }
  };

  // Run Gossip Round
  const handleGossip = async () => {
    setLoading((prev) => ({ ...prev, gossip: true }));
    try {
      const response = await fetch('/api/mesh/gossip', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to run gossip round');
      }

      const res = await response.json();
      const nextGossipCount = gossipCount + 1;
      setGossipCount(nextGossipCount);
      
      addLog(`🔄 Gossip Round #${nextGossipCount}: ${res.transfers} transfer(s) — Devices: ${JSON.stringify(res.deviceCounts)}`);
      addToast(`Gossip #${nextGossipCount} complete!`, 'success');
      
      // Auto-advance/keep stepper at Step 2
      setActiveStep(2);

      setLastOutcome({
        type: 'GOSSIP',
        status: 'GOSSIPPED',
        gossipRound: nextGossipCount,
        transfers: res.transfers,
        deviceCounts: res.deviceCounts,
        details: `Mesh devices active: ${Object.keys(res.deviceCounts).length}`
      });

      fetchState();
    } catch (err) {
      addToast(err.message, 'error');
      addLog(`❌ Gossip failed: ${err.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, gossip: false }));
    }
  };

  // Bridges Upload to Backend
  const handleFlush = async () => {
    setLoading((prev) => ({ ...prev, flush: true }));
    try {
      // Transition Stepper to Step 3 (Bridge Upload)
      setActiveStep(3);

      const response = await fetch('/api/mesh/flush', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to trigger bridge upload');
      }

      const res = await response.json();
      addLog(`📡 Bridge Upload: ${res.uploadsAttempted} upload attempt(s).`);
      
      let mainOutcome = 'INVALID';
      let hasSettled = false;
      let hasDuplicate = false;

      res.results.forEach((r) => {
        addLog(`   Node: ${r.bridgeNode} | Packet: ${r.packetId.substring(0, 8)} → Outcome: ${r.outcome} ${r.reason ? `(${r.reason})` : ''}`);
        if (r.outcome === 'SETTLED') {
          hasSettled = true;
        } else if (r.outcome === 'DUPLICATE_DROPPED') {
          hasDuplicate = true;
        }
      });

      if (hasSettled) {
        mainOutcome = 'SETTLED';
        addToast('Bridge Ingestion Successful! Payment Settled.', 'success');
        // Auto-advance stepper to Step 4 on successful settlement
        setActiveStep(4);
      } else if (hasDuplicate) {
        mainOutcome = 'DUPLICATE_DROPPED';
        addToast('Duplicate payment upload detected and dropped safely.', 'info');
      } else {
        addToast('No settled packets. Check logs for details.', 'error');
      }

      setLastOutcome({
        type: 'FLUSH',
        status: mainOutcome,
        uploadsAttempted: res.uploadsAttempted,
        results: res.results
      });

      fetchState();
    } catch (err) {
      addToast(err.message, 'error');
      addLog(`❌ Bridge upload failed: ${err.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, flush: false }));
    }
  };

  // Reset Mesh and Cache
  const handleReset = async () => {
    setLoading((prev) => ({ ...prev, reset: true }));
    try {
      const response = await fetch('/api/mesh/reset', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to reset mesh network');
      }

      addLog('🗑 Mesh & Idempotency cache cleared.');
      addToast('Mesh network successfully reset!', 'success');
      
      // Reset demo parameters
      setActiveStep(1);
      setGossipCount(0);
      setLastOutcome(null);
      
      fetchState();
    } catch (err) {
      addToast(err.message, 'error');
      addLog(`❌ Reset failed: ${err.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, reset: false }));
    }
  };

  return (
    <>
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}
            </span>
            <span className="toast-message" style={{ flexGrow: 1 }}>{t.message}</span>
            <button className="toast-close-btn" onClick={() => removeToast(t.id)}>×</button>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="header-title">
            📡 UPI Mesh
          </h1>
          <span className="live-indicator">
            <span className="pulse-dot" />
            Live Mesh
          </span>
        </div>
        <div className="header-time">{currentTime}</div>
      </header>

      {/* Stepper Flow */}
      <section className="stepper-container">
        <div 
          className={`step-card ${activeStep === 1 ? 'active' : ''} ${activeStep > 1 ? 'completed' : ''}`}
          onClick={() => setActiveStep(1)}
        >
          <span className="step-number">1</span>
          <div className="step-details">
            <span className="step-title">Compose</span>
            <span className="step-subtitle">Form & encrypt</span>
          </div>
        </div>

        <div 
          className={`step-card ${activeStep === 2 ? 'active' : ''} ${activeStep > 2 ? 'completed' : ''}`}
          onClick={() => setActiveStep(2)}
        >
          <span className="step-number">2</span>
          <div className="step-details">
            <span className="step-title">Gossip {gossipCount > 0 && `(×${gossipCount})`}</span>
            <span className="step-subtitle">Hop device-to-device</span>
          </div>
        </div>

        <div 
          className={`step-card ${activeStep === 3 ? 'active' : ''} ${activeStep > 3 ? 'completed' : ''}`}
          onClick={() => setActiveStep(3)}
        >
          <span className="step-number">3</span>
          <div className="step-details">
            <span className="step-title">Bridge Upload</span>
            <span className="step-subtitle">Submit 4G node</span>
          </div>
        </div>

        <div 
          className={`step-card ${activeStep === 4 ? 'active' : ''}`}
          onClick={() => setActiveStep(4)}
        >
          <span className="step-number">4</span>
          <div className="step-details">
            <span className="step-title">Settled ✓</span>
            <span className="step-subtitle">Idempotency & ledger</span>
          </div>
        </div>
      </section>

      {/* Dashboard Main Grid */}
      <main className="dashboard-grid">
        
        {/* LEFT COLUMN: Controls & Logs */}
        <section className="column-left">
          
          {/* Payment Composer Card */}
          <div className="panel-card">
            <h2 className="card-title">📤 Payment Composer</h2>
            <form onSubmit={handleInject}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="senderSelect">Sender VPA</label>
                  <select 
                    id="senderSelect"
                    className="input-control" 
                    value={senderVpa}
                    onChange={(e) => setSenderVpa(e.target.value)}
                  >
                    {accounts.length > 0 ? (
                      accounts.map((a) => (
                        <option key={a.vpa} value={a.vpa}>{a.vpa} ({a.holderName})</option>
                      ))
                    ) : (
                      <>
                        <option value="alice@demo">alice@demo</option>
                        <option value="bob@demo">bob@demo</option>
                        <option value="carol@demo">carol@demo</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="receiverSelect">Receiver VPA</label>
                  <select 
                    id="receiverSelect"
                    className="input-control" 
                    value={receiverVpa}
                    onChange={(e) => setReceiverVpa(e.target.value)}
                  >
                    {accounts.length > 0 ? (
                      accounts.map((a) => (
                        <option key={a.vpa} value={a.vpa}>{a.vpa} ({a.holderName})</option>
                      ))
                    ) : (
                      <>
                        <option value="bob@demo">bob@demo</option>
                        <option value="carol@demo">carol@demo</option>
                        <option value="alice@demo">alice@demo</option>
                        <option value="dave@demo">dave@demo</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="amountInput">Amount (₹)</label>
                  <input 
                    id="amountInput"
                    className="input-control" 
                    type="number" 
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="500"
                    min="1"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="pinInput">4-Digit PIN</label>
                  <input 
                    id="pinInput"
                    className="input-control" 
                    type="password" 
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').substring(0, 4))}
                    placeholder="••••"
                    maxLength={4}
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className="btn-primary" 
                disabled={loading.inject}
                style={{ marginTop: '8px' }}
              >
                {loading.inject ? (
                  <>
                    <span className="spinner" />
                    Encrypting & Injecting...
                  </>
                ) : (
                  <>📤 Inject into Mesh</>
                )}
              </button>
            </form>
          </div>

          {/* Action buttons row */}
          <div className="actions-row">
            <button 
              className="btn-secondary" 
              onClick={handleGossip} 
              disabled={loading.gossip}
            >
              {loading.gossip ? <span className="spinner" /> : '🔄'} Run Gossip
            </button>
            <button 
              className="btn-secondary" 
              onClick={handleFlush} 
              disabled={loading.flush}
            >
              {loading.flush ? <span className="spinner" /> : '📡'} Bridges Upload
            </button>
            <button 
              className="btn-secondary btn-danger" 
              onClick={handleReset} 
              disabled={loading.reset}
            >
              {loading.reset ? <span className="spinner" /> : '🔁'} Reset Mesh
            </button>
          </div>

          {/* Last API response box */}
          <div className="panel-card" style={{ flexGrow: 1 }}>
            <h2 className="card-title">💾 Last API Outcome</h2>
            <div className="outcome-box">
              {lastOutcome ? (
                <>
                  <div className="outcome-title">
                    <span>API: {lastOutcome.type}</span>
                    <span className={`outcome-status-badge ${lastOutcome.status.toLowerCase()}`}>
                      {lastOutcome.status}
                    </span>
                  </div>
                  
                  {lastOutcome.type === 'INJECT' && (
                    <div className="outcome-log-line">
                      <div><span className="terminal-dim">Packet ID:</span> <span className="terminal-cyan">{lastOutcome.packetId}</span></div>
                      <div><span className="terminal-dim">Injected At:</span> {lastOutcome.injectedAt}</div>
                      <div><span className="terminal-dim">Ciphertext:</span> <span className="terminal-accent" style={{ wordBreak: 'break-all' }}>{lastOutcome.ciphertextPreview}</span></div>
                      <div style={{ marginTop: '4px' }}><span className="terminal-dim">Info:</span> {lastOutcome.details}</div>
                    </div>
                  )}

                  {lastOutcome.type === 'GOSSIP' && (
                    <div className="outcome-log-line">
                      <div><span className="terminal-dim">Gossip Round:</span> #{lastOutcome.gossipRound}</div>
                      <div><span className="terminal-dim">Total Hop Transfers:</span> <span className="terminal-cyan">{lastOutcome.transfers}</span></div>
                      <div style={{ marginTop: '4px' }}><span className="terminal-dim">Distribution:</span></div>
                      {Object.entries(lastOutcome.deviceCounts).map(([dev, count]) => (
                        <div key={dev} style={{ paddingLeft: '8px' }}>
                          <span className="terminal-dim">{dev}:</span> {count} packet(s)
                        </div>
                      ))}
                    </div>
                  )}

                  {lastOutcome.type === 'FLUSH' && (
                    <div className="outcome-log-line">
                      <div><span className="terminal-dim">Upload Attempts:</span> {lastOutcome.uploadsAttempted}</div>
                      <div style={{ marginTop: '6px' }}><span className="terminal-dim">Ingestion Results:</span></div>
                      {lastOutcome.results.map((r, i) => (
                        <div key={i} style={{ paddingLeft: '8px', borderBottom: '1px solid #1e2d4a55', paddingBottom: '4px', marginBottom: '4px' }}>
                          <div><span className="terminal-dim">Bridge:</span> {r.bridgeNode}</div>
                          <div><span className="terminal-dim">Packet:</span> <span className="terminal-cyan">{r.packetId.substring(0, 8)}...</span></div>
                          <div>
                            <span className="terminal-dim">Status: </span>
                            <span className={r.outcome === 'SETTLED' ? 'terminal-accent' : r.outcome === 'DUPLICATE_DROPPED' ? 'terminal-cyan' : 'terminal-dim'}>
                              {r.outcome}
                            </span>
                            {r.reason && ` (${r.reason})`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', paddingTop: '16px' }}>
                  No active outcomes. Inject a payment to begin the mesh pipeline.
                </div>
              )}
            </div>
          </div>

          {/* Activity Log */}
          <div className="panel-card">
            <h2 className="card-title">🪵 Mesh Activity Log</h2>
            <div className="log-console">
              {logs.length > 0 ? (
                logs.map((log, index) => <div key={index}>{log}</div>)
              ) : (
                <div style={{ color: 'var(--text-secondary)' }}>System ready. Awaiting interaction...</div>
              )}
            </div>
          </div>

        </section>

        {/* RIGHT COLUMN: Visualizer & Ledger */}
        <section className="column-right">
          
          {/* Mesh Network Visualizer */}
          <div className="panel-card">
            <h2 className="card-title">📱 Mesh Network Visualizer</h2>
            <div className="devices-grid">
              {meshState.devices.map((device) => {
                const hasPackets = device.packetCount > 0;
                return (
                  <div 
                    key={device.deviceId} 
                    className={`device-card ${hasPackets ? 'glow' : ''}`}
                  >
                    <div className="device-header">
                      <span className="device-name">{device.deviceId}</span>
                      <span className={`device-badge ${device.hasInternet ? 'bridge' : 'offline'}`}>
                        {device.hasInternet ? 'BRIDGE' : 'OFFLINE'}
                      </span>
                    </div>
                    
                    <div className="device-meta">
                      Holding {device.packetCount} packet(s)
                    </div>

                    <div className="device-packet-list">
                      {device.packetIds.map((id, index) => {
                        // In an actual mock structure, the prompt mentions "TTL of each packet".
                        // In the backend state API, packetIds represents list of IDs. We can display them inside badges
                        return (
                          <span key={index} className="packet-pill">
                            📦 {id.substring(0, 5)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Account Balances Card */}
          <div className="panel-card">
            <h2 className="card-title">🏦 Account Balances</h2>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>VPA Address</th>
                    <th>Holder</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const flash = flashes[a.vpa];
                    const flashClass = flash && (Date.now() - flash.timestamp < 1500)
                      ? (flash.type === 'credit' ? 'flash-credit-active' : 'flash-debit-active')
                      : '';
                    return (
                      <tr key={a.vpa}>
                        <td>{a.vpa}</td>
                        <td>{a.holderName}</td>
                        <td className={`balance-cell ${flashClass}`}>
                          ₹{parseFloat(a.balance).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '12px', textAlign: 'right' }}>
              Idempotency Cache Size: {meshState.idempotencyCacheSize}
            </div>
          </div>

          {/* Transaction Ledger Card */}
          <div className="panel-card" style={{ marginBottom: 0 }}>
            <h2 className="card-title">📜 Transaction Ledger</h2>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 10).map((t) => {
                    const isNew = newTxIds.has(t.id);
                    return (
                      <tr key={t.id} className={isNew ? 'new-tx-row' : ''}>
                        <td style={{ color: 'var(--text-secondary)' }}>{t.id}</td>
                        <td>{t.senderVpa}</td>
                        <td>{t.receiverVpa}</td>
                        <td>₹{parseFloat(t.amount).toFixed(2)}</td>
                        <td>
                          <span className={`status-pill ${t.status.toLowerCase()}`}>
                            {t.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                          {new Date(t.settledAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px 0' }}>
                        No transactions registered on server.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </section>

      </main>
    </>
  );
}

export default App;
