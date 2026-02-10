const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10890;
const DATA_FILE = path.join(__dirname, 'leave_data.json');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Serve leave-board.html as the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'leave-board.html'));
});

// API Routes

// GET: Retrieve all leave records
app.get('/api/leave-records', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    // If file doesn't exist, return empty data
    return res.json({ leaveData: {}, employeeInfo: {}, updatedAt: null });
  }

  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading data file:', err);
      return res.status(500).json({ error: 'Failed to read data' });
    }
    try {
      res.json(JSON.parse(data));
    } catch (parseError) {
      console.error('Error parsing data file:', parseError);
      res.json({});
    }
  });
});

// POST: Save leave records
app.post('/api/leave-records', (req, res) => {
  const data = req.body;
  
  if (!data) {
    return res.status(400).json({ error: 'No data provided' });
  }

  fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error('Error writing data file:', err);
      return res.status(500).json({ error: 'Failed to save data' });
    }
    console.log('Data saved successfully at', new Date().toISOString());
    res.json({ success: true, message: 'Data saved successfully' });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
