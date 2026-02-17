import React, { useState, useRef } from 'react';
import { Upload, X, File, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import styles from '../scss/FileUploadWidget.module.scss';

function FileUploadWidget({ onClose, onUploadComplete }) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    addFiles(selectedFiles);
  };

  const addFiles = (newFiles) => {
    // Filter for PDF and Excel files
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    const allowedExtensions = ['.pdf', '.xlsx', '.xls'];
    
    const validFiles = newFiles.filter(file => {
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      return allowedTypes.includes(file.type) || allowedExtensions.includes(fileExtension);
    });

    if (validFiles.length !== newFiles.length) {
      alert('Some files were skipped. Only PDF and Excel files are allowed.');
    }

    setFiles(prev => {
      const combined = [...prev, ...validFiles];
      // Remove duplicates by name
      const unique = combined.filter((file, index, self) =>
        index === self.findIndex(f => f.name === file.name && f.size === file.size)
      );
      return unique;
    });
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const resetWidget = () => {
    setFiles([]);
    setUploadSuccess(false);
    setUploadProgress({});
    setIsUploading(false);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadProgress({});

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      // Upload files but don't process them
      const response = await fetch('/api/v1/invoice/upload-only', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Mark all files as uploaded
      const progress = {};
      files.forEach((_, index) => {
        progress[index] = 100;
      });
      setUploadProgress(progress);

      // Keep loading state, then show success after 2 seconds
      setTimeout(() => {
        setUploadSuccess(true);
        setIsUploading(false);
        
        // Call completion callback after showing success
        if (onUploadComplete) {
          onUploadComplete(data);
        }
      }, 2000); // Wait 2 seconds after upload completes
    } catch (error) {
      console.error('Upload error:', error);
      alert(`Upload failed: ${error.message}`);
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={styles.uploadWidget}
    >
      <div className={styles.widgetHeader}>
        <h3>Upload Documents</h3>
        <button onClick={onClose} className={styles.closeBtn} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div className={styles.widgetContent}>
        {uploadSuccess ? (
          <div className={styles.successState}>
            <CheckCircle2 size={48} className={styles.successIcon} />
            <p className={styles.successText}>
              Files uploaded successfully!
            </p>
            <p className={styles.successSubtext}>
              {files.length} file{files.length !== 1 ? 's' : ''} uploaded
            </p>
            <button
              onClick={resetWidget}
              className={styles.uploadMoreBtn}
            >
              Upload More Files
            </button>
          </div>
        ) : isUploading ? (
          <div className={styles.loadingState}>
            <Loader2 size={48} className={styles.loadingIcon} />
            <p className={styles.loadingText}>
              Uploading files...
            </p>
            <p className={styles.loadingSubtext}>
              Please wait while we upload your files
            </p>
          </div>
        ) : (
          <div
            className={`${styles.dropZone} ${isDragging ? styles.dragging : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={32} className={styles.uploadIcon} />
            <p className={styles.dropZoneText}>
              Drag and drop files here, or click to select
            </p>
            <p className={styles.dropZoneSubtext}>
              PDF and Excel files only
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileSelect}
              className={styles.fileInput}
            />
          </div>
        )}

        <AnimatePresence>
          {files.length > 0 && !isUploading && !uploadSuccess && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={styles.filesList}
            >
              <h4 className={styles.filesListTitle}>
                Selected Files ({files.length})
              </h4>
              <div className={styles.filesContainer}>
                {files.map((file, index) => (
                  <motion.div
                    key={`${file.name}-${index}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={styles.fileItem}
                  >
                    <File size={16} className={styles.fileIcon} />
                    <div className={styles.fileInfo}>
                      <span className={styles.fileName}>{file.name}</span>
                      <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
                    </div>
                    {uploadProgress[index] === 100 ? (
                      <CheckCircle2 size={18} className={styles.checkIcon} />
                    ) : (
                      <button
                        onClick={() => removeFile(index)}
                        className={styles.removeBtn}
                        disabled={isUploading}
                        aria-label="Remove file"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isUploading && !uploadSuccess && (
        <div className={styles.widgetFooter}>
          <button
            onClick={onClose}
            className={styles.cancelBtn}
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            className={styles.uploadBtn}
            disabled={files.length === 0 || isUploading}
          >
            {isUploading ? 'Uploading...' : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default FileUploadWidget;
