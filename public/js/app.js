const { useState, useEffect } = React;

function App() {
    const [queueStatus, setQueueStatus] = useState(null);
    const [printerStatus, setPrinterStatus] = useState(null);
    const [selectedJob, setSelectedJob] = useState(null);
    const [error, setError] = useState(null);
    const [recentDocuments, setRecentDocuments] = useState([]);
    const [loadingDocs, setLoadingDocs] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [queueRes, printerRes, docsRes] = await Promise.all([
                    fetch('/api/queue'),
                    fetch('/api/printer/status'),
                    fetch('/api/documents/recent')
                ]);
                const queueData = await queueRes.json();
                const printerData = await printerRes.json();
                const docsData = await docsRes.json();
                setQueueStatus(queueData);
                setPrinterStatus(printerData);
                setRecentDocuments(docsData);
            } catch (err) {
                setError('Failed to fetch data');
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    // Accept job handler
    const handleAcceptJob = async (jobId) => {
        try {
            const res = await fetch(`/api/queue/job/${jobId}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acceptedBy: 'Dashboard User' })
            });
            const data = await res.json();
            if (data.success) {
                setQueueStatus(prev => ({ ...prev, jobs: prev.jobs.map(j => j.id === jobId ? { ...j, status: 'processing', acceptedBy: 'Dashboard User' } : j) }));
                alert('Job accepted!');
            } else {
                alert('Failed to accept job: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Failed to accept job: ' + err.message);
        }
    };
    // Cancel job handler (dashboard)
    const handleCancelJobDashboard = async (jobId) => {
        try {
            const res = await fetch(`/api/queue/job/${jobId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                setQueueStatus(prev => ({ ...prev, jobs: prev.jobs.filter(j => j.id !== jobId) }));
                alert('Job cancelled!');
            } else {
                alert('Failed to cancel job: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Failed to cancel job: ' + err.message);
        }
    };

    const handleJobClick = async (jobId) => {
        try {
            const res = await fetch(`/api/jobs/${jobId}`);
            setSelectedJob(await res.json());
        } catch (err) {
            setError('Failed to fetch job details');
        }
    };

    const handleClearRecentDocuments = async () => {
        setLoadingDocs(true);
        try {
            await fetch('/api/documents/recent', { method: 'DELETE' });
            setRecentDocuments([]);
        } catch (err) {
            setError('Failed to clear recent documents');
        } finally {
            setLoadingDocs(false);
        }
    };

    // Helper to get file extension
    const getFileExtension = (fileName) => fileName.split('.').pop().toLowerCase();
    // Helper to check if file is image
    const isImage = (fileName) => ['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(getFileExtension(fileName));
    // Helper to check if file is PDF
    const isPDF = (fileName) => getFileExtension(fileName) === 'pdf';
    // State for image print options
    const [imagePrintOptions, setImagePrintOptions] = useState({}); // { [fileId]: { color: true, perPage: 1 } }
    // State for reprint BW
    const [reprintBW, setReprintBW] = useState({}); // { [fileId]: true }
    // State for PDF preview modal
    const [pdfPreview, setPdfPreview] = useState({ open: false, doc: null });

    const handlePreviewPDF = (doc) => {
        setPdfPreview({ open: true, doc });
    };
    const closePdfPreview = () => {
        setPdfPreview({ open: false, doc: null });
    };

    // Download handler
    const handleDownload = (doc) => {
        window.open(`/storage/documents/${doc.fileName}`, '_blank');
    };

    // Print image handler
    const handlePrintImage = async (doc, color) => {
        // You would call your backend/WhatsApp API to trigger a print job for this image
        // For now, just simulate and set reprintBW
        setReprintBW((prev) => ({ ...prev, [doc.fileId]: color }));
        alert(`Print job for ${doc.originalName || doc.fileName} (${color ? 'Color' : 'B&W'}) sent!`);
    };

    // Images per page handler
    const handleImagesPerPageChange = (fileId, value) => {
        setImagePrintOptions((prev) => ({ ...prev, [fileId]: { ...prev[fileId], perPage: value } }));
    };

    // Split documents
    const pdfDocuments = recentDocuments.filter(doc => isPDF(doc.originalName || doc.fileName));
    const imageDocuments = recentDocuments.filter(doc => isImage(doc.originalName || doc.fileName));

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    {error}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100">
            <nav className="bg-white shadow-lg">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <h1 className="text-xl font-bold">Inkoro</h1>
                        </div>
                        {printerStatus && (
                            <div className="flex items-center">
                                <span className={`inline-block w-3 h-3 rounded-full mr-2 ${
                                    printerStatus.status === 'ready' ? 'bg-green-500' : 'bg-red-500'
                                }`}></span>
                                <span>{printerStatus.name}</span>
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {/* PDF Documents Section */}
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">PDF Documents</h2>
                        <button
                            onClick={handleClearRecentDocuments}
                            className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                            disabled={loadingDocs}
                        >
                            {loadingDocs ? 'Clearing...' : 'Clear All'}
                        </button>
                    </div>
                    <div className="space-y-2">
                        {pdfDocuments.length === 0 ? (
                            <p className="text-gray-500">No recent PDF documents</p>
                        ) : (
                            pdfDocuments.map(doc => (
                                <div key={doc.fileId} className="border rounded p-3 flex justify-between items-center">
                                    <div>
                                        <p className="font-medium">{doc.originalName || doc.fileName}</p>
                                        <p className="text-xs text-gray-500">Received: {new Date(doc.timestamp).toLocaleString()}</p>
                                        <p className="text-xs text-gray-500">Size: {(doc.size / 1024).toFixed(2)} KB</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleDownload(doc)}
                                            className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs"
                                        >
                                            Download
                                        </button>
                                        <button
                                            onClick={() => handlePreviewPDF(doc)}
                                            className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-900 text-xs"
                                        >
                                            Preview
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                {/* PDF Preview Modal */}
                {pdfPreview.open && pdfPreview.doc && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full p-4 relative">
                            <button
                                onClick={closePdfPreview}
                                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-2xl"
                                aria-label="Close"
                            >
                                &times;
                            </button>
                            <h3 className="text-lg font-semibold mb-2">PDF Preview: {pdfPreview.doc.originalName || pdfPreview.doc.fileName}</h3>
                            <div className="w-full" style={{ height: '70vh' }}>
                                <iframe
                                    src={`/storage/documents/${pdfPreview.doc.fileName}`}
                                    title="PDF Preview"
                                    className="w-full h-full border rounded"
                                ></iframe>
                            </div>
                        </div>
                    </div>
                )}
                {/* Image Documents Section */}
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Image Documents</h2>
                    </div>
                    <div className="space-y-2">
                        {imageDocuments.length === 0 ? (
                            <p className="text-gray-500">No recent images</p>
                        ) : (
                            imageDocuments.map(doc => {
                                const ext = getFileExtension(doc.originalName || doc.fileName);
                                const image = isImage(doc.originalName || doc.fileName);
                                const perPage = imagePrintOptions[doc.fileId]?.perPage || 1;
                                const printedColor = reprintBW[doc.fileId];
                                return (
                                    <div key={doc.fileId} className="border rounded p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                        <div className="flex-1">
                                            <p className="font-medium">{doc.originalName || doc.fileName}</p>
                                            <p className="text-xs text-gray-500">Received: {new Date(doc.timestamp).toLocaleString()}</p>
                                            <p className="text-xs text-gray-500">Size: {(doc.size / 1024).toFixed(2)} KB</p>
                                            {image && (
                                                <div className="mt-2">
                                                    <img
                                                        src={`/storage/documents/${doc.fileName}`}
                                                        alt={doc.originalName || doc.fileName}
                                                        className="max-h-32 rounded shadow border"
                                                        style={{ objectFit: 'contain' }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2 items-end">
                                            <button
                                                onClick={() => handleDownload(doc)}
                                                className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs"
                                            >
                                                Download
                                            </button>
                                            {image && (
                                                <>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <label className="text-xs">Images per page:</label>
                                                        <select
                                                            value={perPage}
                                                            onChange={e => handleImagesPerPageChange(doc.fileId, parseInt(e.target.value))}
                                                            className="border rounded px-1 py-0.5 text-xs"
                                                        >
                                                            {[1,2,4,6,8,9,12,16].map(n => (
                                                                <option key={n} value={n}>{n}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="flex gap-2 mt-2">
                                                        <button
                                                            onClick={() => handlePrintImage(doc, true)}
                                                            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs"
                                                        >
                                                            Print in Color
                                                        </button>
                                                        <button
                                                            onClick={() => handlePrintImage(doc, false)}
                                                            className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-900 text-xs"
                                                        >
                                                            Print in B&W
                                                        </button>
                                                    </div>
                                                    {printedColor && (
                                                        <button
                                                            onClick={() => handlePrintImage(doc, false)}
                                                            className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-900 text-xs mt-2"
                                                        >
                                                            Reprint in B&W
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
                <div className="px-4 py-6 sm:px-0">
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        {/* Queue Status */}
                        <div className="bg-white overflow-hidden shadow rounded-lg">
                            <div className="px-4 py-5 sm:p-6">
                                <h2 className="text-lg font-medium mb-4">Print Queue</h2>
                                {queueStatus && (
                                    <div className="space-y-4">
                                        {queueStatus.jobs.map(job => (
                                            <div
                                                key={job.id}
                                                className="border rounded p-4 hover:bg-gray-50 cursor-pointer"
                                                onClick={() => handleJobClick(job.id)}
                                            >
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <p className="font-medium">Job #{job.id}</p>
                                                        <p className="text-sm text-gray-500">
                                                            Status: {job.status}
                                                        </p>
                                                        {job.acceptedBy && (
                                                            <p className="text-xs text-green-700">Accepted by: {job.acceptedBy}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={e => { e.stopPropagation(); handleAcceptJob(job.id); }}
                                                            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs"
                                                            disabled={job.status === 'processing' || job.acceptedBy}
                                                        >
                                                            Accept
                                                        </button>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); handleCancelJobDashboard(job.id); }}
                                                            className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                                {job.progress && (
                                                    <div className="mt-2">
                                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                                            <div
                                                                className="bg-blue-600 h-2 rounded-full"
                                                                style={{ width: `${job.progress}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Job Details */}
                        <div className="bg-white overflow-hidden shadow rounded-lg">
                            <div className="px-4 py-5 sm:p-6">
                                <h2 className="text-lg font-medium mb-4">Job Details</h2>
                                {selectedJob ? (
                                    <div className="space-y-4">
                                        <div>
                                            <p className="text-sm text-gray-500">Job ID</p>
                                            <p className="font-medium">{selectedJob.id}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Status</p>
                                            <p className="font-medium">{selectedJob.status}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Instructions</p>
                                            <p className="font-medium">{selectedJob.instructions}</p>
                                        </div>
                                        {selectedJob.acceptedBy && (
                                            <div>
                                                <p className="text-sm text-gray-500">Accepted By</p>
                                                <p className="font-medium text-green-700">{selectedJob.acceptedBy}</p>
                                            </div>
                                        )}
                                        {selectedJob.error && (
                                            <div className="text-red-600">
                                                <p className="text-sm">Error</p>
                                                <p>{selectedJob.error}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-gray-500">Select a job to view details</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('root')); 