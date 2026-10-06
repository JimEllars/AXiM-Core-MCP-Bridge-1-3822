import React, { useState, useEffect } from 'react';

function App() {
  const [telemetry, setTelemetry] = useState({ ping: '...', uptime: '...', status: 'Unknown', suspended: false });
  const [tools, setTools] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [bridgeSecret, setBridgeSecret] = useState('');
  const [dockConfig, setDockConfig] = useState(null);

  const workerDomain = window.location.hostname === 'localhost' ? 'http://localhost:8787' : window.location.origin;

  useEffect(() => {
    // Simulate fetching telemetry
    setTelemetry({
      ping: '42ms',
      uptime: '99.99%',
      status: 'Online',
      suspended: false
    });

    // Initial tool list (simulate)
    setTools([
      { name: 'bridge_runtime_status', schema: '{}', latency: '12ms' },
      { name: 'bridge_security_check', schema: '{}', latency: '45ms' },
      { name: 'sanitizer_self_test', schema: '{}', latency: '8ms' },
      { name: 'aximDockConfig', schema: '{}', latency: '5ms' }
    ]);

    // Simulate audit log
    setAuditLog([
      { id: 1, time: new Date().toLocaleTimeString(), method: 'tools/list', status: 'OK' },
      { id: 2, time: new Date().toLocaleTimeString(), method: 'tools/call', status: 'Rate Limited' }
    ]);
  }, []);

  const handleGenerateConfig = async () => {
    try {
      const res = await fetch(`${workerDomain}/dock/config`, {
        headers: {
          'Authorization': `Bearer ${bridgeSecret}`,
          'CF-Access-Client-Id': 'cf-client-id',
          'CF-Access-Client-Secret': 'cf-client-secret'
        }
      });
      if (res.ok) {
        const config = await res.json();
        setDockConfig(config);
      } else {
        alert('Failed to generate config. Check secret.');
      }
    } catch (e) {
      console.error(e);
      // Fallback for dev/UI testing without real backend
      setDockConfig({
        mcpServers: {
          "axim-core": {
            url: `${workerDomain}/sse`,
            headers: { Authorization: `Bearer ${bridgeSecret || 'YOUR_TOKEN'}` }
          }
        }
      });
    }
  };

  const copyConfig = () => {
    if (dockConfig) {
      navigator.clipboard.writeText(JSON.stringify(dockConfig, null, 2));
      alert('Config copied to clipboard');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-mono">
      <h1 className="text-3xl font-bold mb-8 text-blue-400">AXiM Core Internal Telemetry Console</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-green-400">Bridge Telemetry</h2>
          <div className="space-y-2">
            <p><span className="text-gray-400">Status:</span> <span className={telemetry.status === 'Online' ? 'text-green-500' : 'text-red-500'}>{telemetry.status}</span></p>
            <p><span className="text-gray-400">Ping:</span> {telemetry.ping}</p>
            <p><span className="text-gray-400">Uptime:</span> {telemetry.uptime}</p>
            <p><span className="text-gray-400">Endpoints:</span> <span className="text-blue-300">/mcp, /sse</span></p>
            <p><span className="text-gray-400">Kill Switch:</span> {telemetry.suspended ? <span className="text-red-500 font-bold">ENGAGED</span> : <span className="text-green-500">DISARMED</span>}</p>
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-purple-400">Docking Key Manager</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 mb-1 text-sm">Bridge Secret</label>
              <input
                type="password"
                value={bridgeSecret}
                onChange={(e) => setBridgeSecret(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white"
                placeholder="Enter BRIDGE_SECRET"
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
                  Copy JSON
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
                  <th className="py-2 text-gray-400">Schema Summary</th>
                  <th className="py-2 text-gray-400">Usage Latency</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 font-semibold text-blue-300">{t.name}</td>
                    <td className="py-2 text-sm text-gray-300">{t.schema}</td>
                    <td className="py-2 text-sm text-gray-300">{t.latency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 h-96 flex flex-col">
          <h2 className="text-xl font-semibold mb-4 text-red-400">Audit Feed</h2>
          <div className="flex-1 overflow-y-auto space-y-2 text-xs">
            {auditLog.map(log => (
              <div key={log.id} className="p-2 bg-gray-900 rounded border border-gray-700 flex justify-between">
                <span className="text-gray-500">{log.time}</span>
                <span className="text-blue-400">{log.method}</span>
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
