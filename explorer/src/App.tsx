import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import BlockDetail from './pages/BlockDetail';
import TxDetail from './pages/TxDetail';
import AddressDetail from './pages/AddressDetail';
import Registry from './pages/Registry';
import Wallets from './pages/Wallets';
import AllBlocks from './pages/AllBlocks';
import AllTransactions from './pages/AllTransactions';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/block/:blockNumber" element={<BlockDetail />} />
          <Route path="/tx/:txHash" element={<TxDetail />} />
          <Route path="/address/:address" element={<AddressDetail />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/blocks" element={<AllBlocks />} />
          <Route path="/txs" element={<AllTransactions />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
