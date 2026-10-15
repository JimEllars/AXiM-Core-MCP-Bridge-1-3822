import React, { useState, useEffect } from 'react';
import SafeIcon from './common/SafeIcon.jsx';

function App() {
  const [telemetry, setTelemetry] = useState({ ping: '...', uptime: '...', status: 'Unknown', suspended: false,
    colo: 'Pending' });
  const [tools, setTools] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [activeToolResult, setActiveToolResult] = useState(null);
  const [bridgeSecret, setBridgeSecret] = useState(localStorage.getItem('bridgeSecret') || '');
  const [bridgeUrl, setBridgeUrl] = useState(localStorage.getItem('bridgeUrl') || (window.location.hostname === 'localhost' ? 'http://localhost:8787' : window.location.origin));
  const [clientId, setClientId] = useState(localStorage.getItem('clientId') || '');
  const [clientSecret, setClientSecret] = useState(localStorage.getItem('clientSecret') || '');
  const [dockConfig, setDockConfig] = useState(null);
  const [healthPing, setHealthPing] = useState(null);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [hitlArgs, setHitlArgs] = useState({ limit: 10 });
  const [telemetryArgs, setTelemetryArgs] = useState({ limit: 5, component: '', severity: '' });

  useEffect(() => {
    localStorage.setItem('bridgeSecret', bridgeSecret);
    localStorage.setItem('bridgeUrl', bridgeUrl);
    localStorage.setItem('clientId', clientId);
    localStorage.setItem('clientSecret', clientSecret);
  }, [bridgeSecret, bridgeUrl, clientId, clientSecret]);

  useEffect(() => {
    // Initial tool list (simulate)
    setTools([
      { name: 'bridge_runtime_status', schema: '{}', latency: '12ms', desc: 'Checks bridge runtime status.' },
      { name: 'bridge_security_check', schema: '{}', latency: '45ms', desc: 'Validates bridge security.' },
      { name: 'sanitizer_self_test', schema: '{}', latency: '8ms', desc: 'Tests data egress sanitization.' },
      { name: 'aximDockConfig', schema: '{}', latency: '5ms', desc: 'Provides docking configuration.' },
      { name: 'core_health_check', schema: '{}', latency: '20ms', desc: 'Pings Supabase Core REST API.' },
      { name: 'telemetry_lookup', schema: '{"limit": number, "service_name": string}', latency: '35ms', desc: 'Fetches recent Supabase telemetry events.' },
      { name: 'hitl_queue_status', schema: '{}', latency: '25ms', desc: 'Fetches human-in-the-loop pending approval queue.' }
    ]);

    // Simulate audit log
    setAuditLog([
      { id: 1, time: new Date().toLocaleTimeString(), method: 'tools/list', status: 'OK' },
      { id: 2, time: new Date().toLocaleTimeString(), method: 'tools/call', status: 'Rate Limited' }
    ]);
  }, []);

  const handleRunTool = async (toolName) => {
    const start = Date.now();
    try {
      let args = {};
      if (toolName === 'hitl_queue_status') {
      args = hitlArgs;
    }
    if (toolName === 'telemetry_lookup') {
        args = { limit: telemetryArgs.limit };
        if (telemetryArgs.component) args.component = telemetryArgs.component;
        if (telemetryArgs.severity) args.severity = telemetryArgs.severity;
      }

      const payload = {
        jsonrpc: '2.0',
        id: `run-${Date.now()}`,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      };

      const res = await fetch(`${bridgeUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${bridgeSecret}`,
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret
        },
        body: JSON.stringify(payload)
      });
      const end = Date.now();
      const latency = end - start;
      const status = res.ok ? 'OK' : `HTTP_${res.status}`;

      let data = {};
      if (res.ok) {
        data = await res.json();
      }

      setActiveToolResult({ tool: toolName, data, latency });

      // Dynamic Row Latency Update
      setTools(prevTools => prevTools.map(t => t.name === toolName ? { ...t, latency: `${latency}ms` } : t));

      setAuditLog(prev => [
        { id: Date.now(), time: new Date().toLocaleTimeString(), method: toolName, status },
        ...prev
      ]);
    } catch (e) {
      const end = Date.now();
      const latency = end - start;
      setActiveToolResult({ tool: toolName, data: { error: e.message }, latency });
      setTools(prevTools => prevTools.map(t => t.name === toolName ? { ...t, latency: `${latency}ms` } : t));
      setAuditLog(prev => [
        { id: Date.now(), time: new Date().toLocaleTimeString(), method: toolName, status: 'ERROR' },
        ...prev
      ]);
    }
  };

  const handleGenerateConfig = async () => {
    const config = {
      mcpServers: {
        "axim-core-internal": {
          url: `${bridgeUrl}/sse`,
          headers: {
            "CF-Access-Client-Id": clientId || "<YOUR_CF_ACCESS_CLIENT_ID>",
            "CF-Access-Client-Secret": clientSecret || "<YOUR_CF_ACCESS_CLIENT_SECRET>",
            "Authorization": `Bearer ${bridgeSecret || "<YOUR_PASSPORT_TOKEN>"}`
          }
        }
      }
    };
    setDockConfig(config);
  };

  const handleHealthProbe = async () => {
    setHealthPing('Pinging...');
    const start = Date.now();
    try {
      const payload = {
        jsonrpc: '2.0',
        id: 'probe-1',
        method: 'tools/call',
        params: {
          name: 'bridge_runtime_status',
          arguments: {}
        }
      };

      const res = await fetch(`${bridgeUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${bridgeSecret}`,
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret
        },
        body: JSON.stringify(payload)
      });
      const end = Date.now();
      if (res.ok) {
        setHealthPing(`${end - start}ms latency`);
        const json = await res.json();
        if (json.result && json.result.content && json.result.content[0]) {
           const parsed = JSON.parse(json.result.content[0].text);
           setTelemetry({
             ping: `${end - start}ms`,
             uptime: '99.99%',
             status: parsed.status || 'Online',
             colo: parsed.edge_node || 'Unknown',
             suspended: parsed.kill_switch === 'SUSPENDED'
           });
        }
      } else {
        setHealthPing(`Failed HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(e);
      setHealthPing(`Error: ${e.message}`);
    }
  };

  const copyConfig = () => {
    if (dockConfig) {
      navigator.clipboard.writeText(JSON.stringify(dockConfig, null, 2));
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-mono">
      <h1 className="text-3xl font-bold mb-8 text-blue-400">AXiM Core Internal Telemetry Console</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-green-400">Bridge Telemetry</h2>
          <div className="space-y-2 mb-4">
            <p><span className="text-gray-400">Status:</span> <span className={telemetry.status === 'OPERATIONAL' || telemetry.status === 'Online' ? 'text-green-500' : 'text-red-500'}>{telemetry.status}</span></p>
            <p><span className="text-gray-400">Ping:</span> {telemetry.ping}</p>
            <p><span className="text-gray-400">Edge Node:</span> {telemetry.colo}</p>
            <p><span className="text-gray-400">Uptime:</span> {telemetry.uptime}</p>
            <p><span className="text-gray-400">Endpoints:</span> <span className="text-blue-300">/mcp, /sse</span></p>
            <p><span className="text-gray-400">Kill Switch:</span> {telemetry.suspended ? <span className="text-red-500 font-bold">ENGAGED</span> : <span className="text-green-500">DISARMED</span>}</p>
          </div>
          <button
            onClick={handleHealthProbe}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded w-full transition"
          >
            Live Health Probe
          </button>
          {healthPing && <p className="mt-2 text-sm text-gray-300 text-center">{healthPing}</p>}
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-purple-400">Docking Key Manager</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 mb-1 text-sm">Bridge URL</label>
              <input
                type="text"
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white"
                placeholder="https://mcp.axim.us.com"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-1 text-sm">CF-Access-Client-Id</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white"
                placeholder="Enter Client ID"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-1 text-sm">CF-Access-Client-Secret</label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white"
                placeholder="Enter Client Secret"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-1 text-sm">Bearer Token</label>
              <input
                type="password"
                value={bridgeSecret}
                onChange={(e) => setBridgeSecret(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white"
                placeholder="Enter Token"
              />
            </div>
            <button
              onClick={handleGenerateConfig}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded w-full transition"
            >
              Generate Config
            </button>
            {dockConfig && (
              <div className="mt-4">
                <pre className="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-green-300">
                  {JSON.stringify(dockConfig, null, 2)}
                </pre>
                <button
                  onClick={copyConfig}
                  className="mt-2 bg-gray-600 hover:bg-gray-500 text-white text-xs py-1 px-3 rounded"
                >
                  {copiedConfig ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4 text-yellow-400">Active Tool Registry</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="py-2 text-gray-400">Tool Name</th>
                  <th className="py-2 text-gray-400">Description</th>
                  <th className="py-2 text-gray-400">Schema Summary</th>
                  <th className="py-2 text-gray-400">Usage Latency</th>
                  <th className="py-2 text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t, idx) => (
                  <React.Fragment key={idx}>
                    <tr className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 font-semibold text-blue-300">
                        <div className="flex items-center gap-2">
                          <SafeIcon name="Activity" className="text-green-500" />
                          {t.name}
                        </div>
                      </td>
                      <td className="py-2 text-sm text-gray-300">{t.desc}</td>
                      <td className="py-2 text-sm text-gray-400">
                        {t.name === 'hitl_queue_status' ? (
                          <div className="flex flex-col gap-1 mt-1">
                            <input type="number" placeholder="Limit" className="bg-gray-700 text-white p-1 text-xs rounded" value={hitlArgs.limit} onChange={(e) => setHitlArgs({...hitlArgs, limit: parseInt(e.target.value, 10)})} />
                          </div>
                        ) : t.name === 'telemetry_lookup' ? (
                          <div className="flex flex-col gap-1 mt-1">
                            <input type="number" placeholder="Limit" className="bg-gray-700 text-white p-1 text-xs rounded" value={telemetryArgs.limit} onChange={(e) => setTelemetryArgs({...telemetryArgs, limit: parseInt(e.target.value, 10)})} />
                            <input type="text" placeholder="Component" className="bg-gray-700 text-white p-1 text-xs rounded" value={telemetryArgs.component} onChange={(e) => setTelemetryArgs({...telemetryArgs, component: e.target.value})} />
                            <input type="text" placeholder="Severity (e.g. ERROR,CRITICAL)" className="bg-gray-700 text-white p-1 text-xs rounded" value={telemetryArgs.severity} onChange={(e) => setTelemetryArgs({...telemetryArgs, severity: e.target.value})} />
                          </div>
                        ) : t.schema}
                      </td>
                      <td className="py-2 text-sm text-gray-400">{t.latency}</td>
                      <td className="py-2 text-sm">
                        <button
                          onClick={() => handleRunTool(t.name)}
                          className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-1 px-2 rounded transition"
                        >
                          Run
                        </button>
                      </td>
                    </tr>
                    {activeToolResult && activeToolResult.tool === t.name && (
                      <tr className="bg-gray-800">
                        <td colSpan="5" className="p-4 border-b border-gray-700/50">
                          <div className="flex justify-between mb-2">
                            <span className="text-sm font-semibold text-gray-300">Result ({activeToolResult.latency}ms)</span>
                            <div className="flex gap-2">
                              <button onClick={() => navigator.clipboard.writeText(JSON.stringify(activeToolResult.data, null, 2))} className="text-blue-400 hover:text-blue-300 text-xs">Copy JSON</button>
                              <button onClick={() => setActiveToolResult(null)} className="text-gray-500 hover:text-white text-xs">Close</button>
                            </div>
                          </div>
                          <pre className="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-green-300">
                            {JSON.stringify(activeToolResult.data, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 h-96 flex flex-col">
          <h2 className="text-xl font-semibold mb-4 text-red-400">Audit Feed</h2>
          <div className="flex-1 overflow-y-auto space-y-2 text-xs">
            {auditLog.map(log => (
              <div key={log.id} className="p-2 bg-gray-900 rounded border border-gray-700 flex justify-between items-center">
                <span className="text-gray-500">{log.time}</span>
                <span className="text-blue-400 font-semibold">{log.method}</span>
                <span className={log.status === 'OK' ? 'text-green-500' : 'text-yellow-500'}>{log.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
