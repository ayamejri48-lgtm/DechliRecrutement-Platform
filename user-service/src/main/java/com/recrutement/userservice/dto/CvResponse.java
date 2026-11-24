
package com.recrutement.userservice.dto;

import com.recrutement.userservice.entity.Cv;
import lombok.AllArgsConstructor;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
public class CvResponse {

    private Long id;
    private String fileName;
    private String contentType;
    private Long fileSize;
    private Integer version;
    private Boolean active;
    private Boolean visible;
    private LocalDateTime createdAt;

    public static CvResponse from(Cv cv) {
        return new CvResponse(
                cv.getId(),
                cv.getFileName(),
                cv.getContentType(),
                cv.getFileSize(),
                cv.getVersion(),
                cv.getActive(),
                cv.getVisible(),
                cv.getCreatedAt()
        );
    }
}
